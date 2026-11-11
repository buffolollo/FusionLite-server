/**
 * Client FusionSolar.
 *
 * Percorso completo ricostruito da FusionLite/api/FusionSolarApi.kt e
 * FusionLite/data/FusionRepository.kt (a loro volta ricavati dal dex
 * dell'app ufficiale 26.2.6.001):
 *
 *   login (host di autenticazione)
 *     -> regionFloatIp / regionList[0].regionIp  (host dati)
 *     -> station-list
 *     -> station-real-kpi   (queryTime = mezzanotte locale del giorno)
 *     -> energy-balance     (timeDim 2 = giorno, 4 = mese)
 *
 * Differenze volute rispetto all'app:
 *  - il report riguarda IERI, quindi queryTime è la mezzanotte di ieri;
 *  - i fallback POST/GET e v1/v2 sono gestiti qui e non nel chiamante.
 */

import { ApiError, AuthError, ConfigError, HttpError } from './errors.mjs';
import { createTransport, isAuthRedirect } from './http.mjs';
import { startOfDay, tzHeaderOffset, tzOffsetHours } from './tz.mjs';

const PATHS = {
  login: '/rest/neteco/appauthen/v1/smapp/app/token',
  stationList: '/rest/pvms/web/station/v1/station/station-list',
  realKpi: '/rest/pvms/web/station/v1/overview/station-real-kpi',
  balanceV1: '/rest/pvms/web/station/v1/overview/energy-balance',
  balanceV2: '/rest/pvms/web/station/v2/overview/energy-balance',
};

const FALLBACK_STATUS = new Set([400, 404, 405]);

function parseDataHost(raw, loginHost, loginPort) {
  let value = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\//i, '');
  if (!value) return { host: loginHost, port: loginPort };
  value = value.split('/')[0];

  let host = value;
  let port = loginPort;
  if (value.includes('--')) {
    const index = value.lastIndexOf('--');
    host = value.slice(0, index);
    const candidate = value.slice(index + 2);
    if (candidate) port = candidate;
  } else if (value.includes(':')) {
    const index = value.indexOf(':');
    host = value.slice(0, index);
    const candidate = value.slice(index + 1);
    if (candidate && /^\d+$/.test(candidate)) port = candidate;
  }
  return { host: host || loginHost, port };
}

export class FusionClient {
  constructor({ authHost, authPort, user, password, appClientId, timezone, caPem, log = () => {} }) {
    this.authHost = authHost;
    this.authPort = authPort;
    this.user = user;
    this.password = password;
    this.appClientId = appClientId;
    this.timezone = timezone;
    this.log = log;
    this.session = null;
    this.preferredKpi = null;
    this.preferredBalance = null;
    this.allowedHosts = new Set([authHost.toLowerCase()]);
    this.http = createTransport({ caPem, allowedHosts: this.allowedHosts });
  }

  async login() {
    const url = `https://${this.authHost}:${this.authPort}${PATHS.login}`;
    const body = {
      userName: this.user,
      value: this.password,
      grantType: 'password',
      appClientId: this.appClientId,
      isNeedTwoVerify: false,
      verifyCode: '',
      refreshToken: null,
      isRenew: false,
    };

    let response;
    let retried = false;
    for (;;) {
      try {
        response = await this.http.request({
          url,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          timeoutMs: 30000,
        });
        break;
      } catch (error) {
        if (error instanceof HttpError && error.status === 0 && !retried) {
          retried = true;
          continue;
        }
        throw new AuthError(`Login non raggiungibile: ${error.message}`);
      }
    }

    if (response.status === 429 || response.status >= 500) {
      throw new ApiError(`Login: HTTP ${response.status} (server temporaneamente non disponibile)`);
    }
    const payload = response.json;
    if (!payload) {
      throw new ApiError(`Login: risposta non JSON (HTTP ${response.status})`);
    }

    const data = payload.data ?? null;
    if (!data?.accessToken) {
      const reason =
        data?.exceptionId || payload.description || payload.failMsg || `codice ${payload.code}`;
      const type = String(data?.exceptionType ?? '');
      if (/two|verify/i.test(`${reason} ${type}`)) {
        throw new ConfigError(
          'Login rifiutato: l\'account richiede la verifica in due passaggi (2FA), non supportata.',
        );
      }
      throw new AuthError(`Login rifiutato: ${reason}`);
    }

    const region =
      data.regionFloatIp ??
      data.regionList?.find?.((entry) => entry?.regionIp)?.regionIp ??
      null;
    const { host, port } = parseDataHost(region, this.authHost, this.authPort);
    this.allowedHosts.add(host.toLowerCase());
    this.session = {
      host,
      port,
      token: data.accessToken,
      roaRand: data.roaRand ?? '',
      refreshToken: data.refreshToken ?? null,
    };
    this.log(`login ok, host dati ${host}:${port}`);
    return this.session;
  }

  async ensureSession() {
    if (!this.session) await this.login();
  }

  authHeaders(withJsonBody) {
    const session = this.session;
    const headers = {
      Cookie: `locale=en_US;data-theme=light;bspsession=${session.token};dp-session=${session.token}`,
      'csrf-token': session.roaRand,
      roarand: session.roaRand,
      'x-timezone-offset': tzHeaderOffset(Date.now(), this.timezone),
    };
    if (withJsonBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  buildUrl(path, query) {
    const base = `https://${this.session.host}:${this.session.port}${path}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null) params.append(key, String(value));
    }
    const serialized = params.toString();
    return serialized ? `${base}?${serialized}` : base;
  }

  /**
   * Richiesta autenticata con rinnovo automatico della sessione.
   * Un 302 verso /unisess/v1/auth oppure un 401/403 significano token scaduto.
   */
  async dataRequest(path, { method = 'POST', body = null, query = null, label = 'richiesta' }) {
    await this.ensureSession();
    let renewed = false;
    let networkRetried = false;

    for (;;) {
      let response;
      try {
        response = await this.http.request({
          url: this.buildUrl(path, query),
          method,
          headers: this.authHeaders(method === 'POST'),
          body: method === 'POST' ? body : null,
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 0 && !networkRetried) {
          networkRetried = true;
          continue;
        }
        throw new ApiError(`${label}: ${error.message}`);
      }

      if (isAuthRedirect(response) || response.status === 401 || response.status === 403) {
        if (renewed) throw new AuthError(`${label}: sessione scaduta anche dopo il rinnovo`);
        this.log(`${label}: sessione scaduta, rinnovo`);
        await this.login();
        renewed = true;
        continue;
      }

      if (response.status >= 400) {
        throw new HttpError(
          response.status,
          `${label}: HTTP ${response.status}`,
          response.text?.slice(0, 300) ?? null,
        );
      }

      const payload = response.json;
      if (!payload) {
        throw new ApiError(`${label}: risposta non JSON (HTTP ${response.status})`);
      }

      const code = payload.failCode ?? payload.code;
      if (code != null && Number(code) !== 0) {
        if (Number(code) === 401 || Number(code) === 403) {
          if (renewed) throw new AuthError(`${label}: sessione scaduta`);
          await this.login();
          renewed = true;
          continue;
        }
        throw new ApiError(
          `${label}: ${payload.failMsg || payload.description || payload.message || `codice ${code}`}`,
        );
      }
      return payload;
    }
  }

  async stationList() {
    const envelope = await this.dataRequest(PATHS.stationList, {
      method: 'POST',
      body: { curPage: 1, pageSize: 100 },
      label: 'elenco impianti',
    });
    return envelope.data?.list ?? envelope.data?.stations ?? [];
  }

  findStation(stations, { dn, name }) {
    const list = Array.isArray(stations) ? stations : [];
    if (dn) {
      const found = list.find((station) => station.dn === dn);
      if (found) return found;
    }
    if (name) {
      const wanted = name.trim().toLowerCase();
      const exact = list.find((station) => String(station.name ?? '').trim().toLowerCase() === wanted);
      if (exact) return exact;
      const partial = list.find((station) =>
        String(station.name ?? '').toLowerCase().includes(wanted),
      );
      if (partial) return partial;
    }
    const names = list.map((station) => `"${station.name ?? '?'}"`).join(', ') || '(nessuno)';
    throw new ConfigError(
      `Impianto non trovato. Impianti disponibili: ${names}. ` +
        'Controlla PLANT_NAME oppure usa PLANT_DN.',
    );
  }

  /** KPI del giorno indicato (queryTime = mezzanotte locale). */
  async realKpi(stationDn, dateStr) {
    const queryTime = startOfDay(dateStr, this.timezone);
    const body = {
      stationDn,
      queryTime,
      timeZone: tzOffsetHours(queryTime, this.timezone),
    };
    const attempts = [
      { label: 'KPI POST', method: 'POST', path: PATHS.realKpi, body },
      { label: 'KPI GET', method: 'GET', path: PATHS.realKpi, query: body },
    ];
    if (this.preferredKpi === 'GET') attempts.reverse();

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const envelope = await this.dataRequest(attempt.path, {
          method: attempt.method,
          body: attempt.body,
          query: attempt.query,
          label: attempt.label,
        });
        this.preferredKpi = attempt.method;
        return { data: envelope.data ?? null, transport: attempt.label };
      } catch (error) {
        if (error instanceof HttpError && FALLBACK_STATUS.has(error.status)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new ApiError('KPI giornaliero non disponibile');
  }

  /**
   * Serie storica. `dim` 2 = giorno, 4 = mese (codici StatDim dell'app).
   * Prova v1 POST, v2 POST, v1 GET, v2 GET e ricorda il trasporto che funziona.
   */
  async energyBalance(stationDn, { dim, dateStr, queryTime }) {
    const body = {
      stationDn,
      timeDim: dim,
      dateStr,
      queryTime,
      timeZone: tzOffsetHours(queryTime, this.timezone),
      timeZoneStr: this.timezone,
      _: Date.now(),
    };

    const attempts = [
      { label: 'v1 POST', method: 'POST', path: PATHS.balanceV1, body },
      { label: 'v2 POST', method: 'POST', path: PATHS.balanceV2, body },
      { label: 'v1 GET', method: 'GET', path: PATHS.balanceV1, query: body },
      { label: 'v2 GET', method: 'GET', path: PATHS.balanceV2, query: body },
    ];
    if (this.preferredBalance) {
      attempts.sort(
        (a, b) =>
          Number(b.label === this.preferredBalance) -
          Number(a.label === this.preferredBalance),
      );
    }

    const failures = [];
    for (const attempt of attempts) {
      try {
        const envelope = await this.dataRequest(attempt.path, {
          method: attempt.method,
          body: attempt.body,
          query: attempt.query,
          label: `energia ${dim} ${attempt.label}`,
        });
        const data = envelope.data ?? null;
        const empty =
          !data || ((data.xAxis?.length ?? 0) === 0 && data.totalProductPower == null);
        if (empty) {
          failures.push(`${attempt.label}: serie vuota`);
          continue;
        }
        this.preferredBalance = attempt.label;
        return { data, transport: attempt.label };
      } catch (error) {
        if (error instanceof HttpError && FALLBACK_STATUS.has(error.status)) {
          failures.push(`${attempt.label}: HTTP ${error.status}`);
          continue;
        }
        throw error;
      }
    }
    throw new ApiError(
      `Nessuna serie energetica disponibile (${failures.join('; ') || 'nessun tentativo'})`,
    );
  }
}
