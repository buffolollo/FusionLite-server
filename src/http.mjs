/**
 * Client HTTPS minimale.
 *
 * Due dettagli non negoziabili, identici ad ApiFactory.kt dell'app:
 *  1. il certificato foglia di FusionSolar non ha SAN, quindi la verifica
 *     standard del nome fallisce: la catena viene comunque validata contro la
 *     CA Huawei e solo allora si accettano gli host FusionSolar;
 *  2. i redirect non vengono seguiti: un 302 verso /unisess/v1/auth è il modo
 *     con cui l'API segnala la sessione scaduta.
 */

import https from 'node:https';
import tls from 'node:tls';
import { HttpError } from './errors.mjs';

export { HttpError };

export function isAuthRedirect(response) {
  if (response.status < 300 || response.status >= 400) return false;
  const location = String(response.headers?.location ?? '');
  return location.includes('/unisess/v1/auth') || location.includes('/unisess/v1/logout');
}

export function createTransport({ caPem, allowedHosts = [] }) {
  // Set condiviso: FusionClient aggiunge l'host dati dopo la login.
  const allowed =
    allowedHosts instanceof Set
      ? allowedHosts
      : new Set(allowedHosts.map((host) => String(host).toLowerCase().trim()).filter(Boolean));

  function checkServerIdentity(hostname, cert) {
    const host = String(hostname).toLowerCase();
    if (
      allowed.has(host) ||
      host === 'fusionsolar.huawei.com' ||
      host.endsWith('.fusionsolar.huawei.com') ||
      host.endsWith('.energyorb.com')
    ) {
      return undefined; // catena già verificata con la CA Huawei
    }
    return tls.checkServerIdentity(hostname, cert);
  }

  function request({ url, method = 'GET', headers = {}, body = null, timeoutMs = 60000 }) {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const payload =
        body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
      const requestHeaders = { Accept: 'application/json', ...headers };
      if (payload != null) {
        requestHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = https.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || 443,
          path: target.pathname + target.search,
          method,
          headers: requestHeaders,
          ca: [caPem],
          checkServerIdentity,
          rejectUnauthorized: true,
          agent: false,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            if (text) {
              try {
                json = JSON.parse(text);
              } catch {
                json = null;
              }
            }
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text,
              json,
            });
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`timeout dopo ${timeoutMs} ms`));
      });
      req.on('error', (error) => {
        reject(new HttpError(0, `connessione fallita: ${error.message}`, null));
      });
      if (payload != null) req.write(payload);
      req.end();
    });
  }

  return { request };
}
