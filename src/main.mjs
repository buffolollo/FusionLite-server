#!/usr/bin/env node
/**
 * FusionLite — report giornaliero via email.
 *
 * Uso tipico:
 *   node src/main.mjs                  invia il report di ieri
 *   node src/main.mjs --dry-run        scarica e genera, senza inviare
 *   node src/main.mjs --demo --out ... anteprima con dati finti
 *   node src/main.mjs --check          verifica .env
 *
 * Il file .env viene caricato automaticamente.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  describeConfig,
  loadConfig,
  loadEnvFile,
  readConfig,
  validateConfig,
  validateMail,
} from './config.mjs';
import { ApiError, AuthError, ConfigError, MailError } from './errors.mjs';
import { FusionClient } from './fusion.mjs';
import { buildReport } from './model.mjs';
import { renderHtml, renderText } from './html.mjs';
import { sendReport } from './mail.mjs';
import { readState, writeState } from './state.mjs';
import {
  addDays,
  isDateString,
  itNumber,
  localDateString,
  startOfDay,
} from './tz.mjs';
import { demoInput } from './demo.mjs';

const USAGE = `FusionLite — report giornaliero FusionSolar

Uso: node src/main.mjs [opzioni]

  (nessuna opzione)    invia il report di ieri
  --demo               genera un report di esempio, senza credenziali
  --out FILE           scrive l'HTML in FILE
  --dry-run            scarica i dati e genera l'HTML, ma non invia
  --test-email         invia subito (non aggiorna lo stato)
  --date YYYY-MM-DD    report di un giorno specifico (recupero storico)
  --force              ignora il controllo "già inviato"
  --catch-up           invia solo se il report di ieri manca (per @reboot)
  --to INDIRIZZO       destinatario alternativo (sostituisce quelli configurati)
  --check              verifica la configurazione e mostra i valori mascherati
  --verbose            log dettagliato su stderr
  -h, --help           questo aiuto
`;

function parseArgs(argv) {
  const options = {
    date: null,
    out: null,
    to: null,
    dryRun: false,
    force: false,
    testEmail: false,
    catchUp: false,
    demo: false,
    check: false,
    help: false,
    verbose: false,
  };

  const readValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new ConfigError(`Opzione ${name} senza valore`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--demo') {
      options.demo = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--test-email') {
      options.testEmail = true;
    } else if (arg === '--catch-up') {
      options.catchUp = true;
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--date') {
      options.date = readValue(i, '--date');
      i += 1;
    } else if (arg === '--out') {
      options.out = readValue(i, '--out');
      i += 1;
    } else if (arg === '--to') {
      options.to = readValue(i, '--to');
      i += 1;
    } else if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length);
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
    } else if (arg.startsWith('--to=')) {
      options.to = arg.slice('--to='.length);
    } else {
      throw new ConfigError(`Opzione sconosciuta: ${arg}`);
    }
  }
  return options;
}

function writeOut(file, html) {
  const target = path.resolve(process.cwd(), file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
  console.error(`HTML scritto in ${target}`);
}

function subjectFor(report) {
  return `FusionLite · ${report.dateLabel.short} · ${itNumber(report.production.kwh, 1)} kWh`;
}

function exitCodeFor(error) {
  if (error instanceof ConfigError) return 2;
  if (error instanceof AuthError) return 3;
  if (error instanceof ApiError) return 4;
  if (error instanceof MailError) return 6;
  return 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  loadEnvFile();

  // --- Solo verifica configurazione ---------------------------------------
  if (options.check) {
    const cfg = readConfig();
    const errors = validateConfig(cfg);
    console.log(describeConfig(cfg));
    if (errors.length) {
      console.error('\nConfigurazione incompleta:');
      for (const error of errors) console.error(` - ${error}`);
      return 2;
    }
    console.log('\nConfigurazione OK.');
    return 0;
  }

  const log = (message) => {
    if (options.verbose || process.env.DEBUG) {
      console.error(`[${new Date().toISOString()}] ${message}`);
    }
  };

  // --- Anteprima con dati dimostrativi ------------------------------------
  if (options.demo) {
    const cfg = loadConfig({ requireAll: false });
    if (options.to) cfg.recipients = [options.to];
    if (options.testEmail) {
      const errors = validateMail(cfg);
      if (errors.length) {
        throw new ConfigError(errors.map((line) => `- ${line}`).join('\n'));
      }
    }
    const date = options.date ?? addDays(localDateString(Date.now(), cfg.timezone), -1);
    if (!isDateString(date)) {
      throw new ConfigError(`Data non valida: ${date} (formato YYYY-MM-DD)`);
    }
    const report = buildReport(demoInput(date));
    const html = renderHtml(report, { demo: true });
    const text = renderText(report, { demo: true });
    if (options.out) writeOut(options.out, html);
    if (options.testEmail) {
      const info = await sendReport({
        cfg,
        subject: subjectFor(report),
        text,
        html,
      });
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          date: report.date,
          demo: true,
          sent: true,
          test: true,
          messageId: info.messageId,
        }),
      );
      return 0;
    }
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        date: report.date,
        demo: true,
        sent: false,
        skip: 'anteprima',
      }),
    );
    return 0;
  }

  // --- Report reale -------------------------------------------------------
  // --dry-run non invia: non deve richiedere le credenziali Gmail.
  const cfg = loadConfig({ requireAll: true, requireMail: !options.dryRun });
  if (options.to) cfg.recipients = [options.to];

  const now = Date.now();
  const tz = cfg.timezone;
  const today = localDateString(now, tz);
  const reportDate = options.date ?? addDays(today, -1);
  if (!isDateString(reportDate)) {
    throw new ConfigError(`Data non valida: ${reportDate} (formato YYYY-MM-DD)`);
  }

  if (options.catchUp) {
    const scheduled = startOfDay(today, tz) + 5 * 60 * 1000;
    if (now < scheduled) {
      log("catch-up: prima dell'orario previsto, esco");
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          date: reportDate,
          sent: false,
          skip: 'troppo presto',
        }),
      );
      return 0;
    }
  }

  const state = readState(cfg.stateDir);
  const clientId =
    cfg.appClientId || state.appClientId || crypto.randomBytes(16).toString('hex');
  if (state.appClientId !== clientId) {
    state.appClientId = clientId;
    writeState(cfg.stateDir, state);
  }

  if (!options.force && !options.testEmail && state.lastSentDate === reportDate) {
    log(`report ${reportDate} già inviato, esco`);
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        date: reportDate,
        sent: false,
        skip: 'già inviato',
      }),
    );
    return 0;
  }

  const started = Date.now();
  const caPem = fs.readFileSync(cfg.caPath, 'utf8');
  const client = new FusionClient({
    authHost: cfg.authHost,
    authPort: cfg.authPort,
    user: cfg.user,
    password: cfg.password,
    appClientId: clientId,
    timezone: tz,
    caPem,
    log,
  });

  await client.login();
  const stations = await client.stationList();
  const station = client.findStation(stations, {
    dn: cfg.plantDn,
    name: cfg.plantName,
  });
  log(`impianto: ${station.name} (${station.dn})`);

  // KPI ufficiale: serve solo per il giorno corrente. Sui giorni passati il
  // server ignora queryTime e restituisce i valori di oggi, quindi non va
  // chiamato (i totali di energy-balance sono già quelli giusti).
  let kpi = null;
  let kpiTransport = null;
  if (reportDate === today) {
    try {
      const result = await client.realKpi(station.dn, reportDate);
      kpi = result.data;
      kpiTransport = result.transport;
    } catch (error) {
      if (error instanceof AuthError || error instanceof ConfigError) throw error;
      log(`KPI non disponibile: ${error.message}`);
    }
  }

  // Serie del giorno (necessaria per la curva; se manca resta il KPI).
  let day = null;
  let dayTransport = null;
  let dayError = null;
  try {
    const result = await client.energyBalance(station.dn, {
      dim: '2',
      dateStr: `${reportDate} 00:00:00`,
      queryTime: startOfDay(reportDate, tz),
    });
    day = result.data;
    dayTransport = result.transport;
  } catch (error) {
    if (error instanceof AuthError || error instanceof ConfigError) throw error;
    dayError = error.message;
    log(`serie giornaliera non disponibile: ${error.message}`);
  }

  if (!day && !kpi) {
    throw new ApiError(
      `Nessun dato disponibile per ${reportDate}: ${dayError ?? 'KPI assente'}`,
    );
  }

  // Mese in corso: solo contesto, un errore non blocca il report.
  let month = null;
  try {
    const monthStart = `${reportDate.slice(0, 7)}-01`;
    const result = await client.energyBalance(station.dn, {
      dim: '4',
      dateStr: `${monthStart} 00:00:00`,
      queryTime: startOfDay(monthStart, tz),
    });
    month = result.data;
  } catch (error) {
    if (error instanceof AuthError || error instanceof ConfigError) throw error;
    log(`dati del mese non disponibili: ${error.message}`);
  }

  const report = buildReport({
    station,
    kpi,
    day,
    month,
    date: reportDate,
    today,
    tz,
    tariffs: { buy: cfg.buyCents, sell: cfg.sellCents },
    currency: cfg.currency,
    generatedAt: Date.now(),
    transport: { balance: dayTransport, kpi: kpiTransport },
  });
  if (dayError) {
    report.warnings.unshift(`Serie giornaliera non disponibile: ${dayError}`);
  }

  const html = renderHtml(report, { demo: false });
  const text = renderText(report, { demo: false });
  if (options.out) writeOut(options.out, html);

  const summary = {
    ts: new Date().toISOString(),
    date: reportDate,
    plant: report.plant.name,
    kwh:
      report.production.kwh == null
        ? null
        : Number(report.production.kwh.toFixed(2)),
    transport: report.transport.balance ?? null,
    ms: Date.now() - started,
  };

  if (options.dryRun) {
    console.log(JSON.stringify({ ...summary, sent: false, skip: 'dry-run' }));
    return 0;
  }

  const info = await sendReport({
    cfg,
    subject: subjectFor(report),
    text,
    html,
  });

  console.log(
    JSON.stringify({
      ...summary,
      sent: true,
      test: options.testEmail || undefined,
      messageId: info.messageId,
    }),
  );

  if (!options.testEmail && reportDate === addDays(today, -1)) {
    state.lastSentDate = reportDate;
    state.lastAttemptAt = new Date().toISOString();
    state.lastResult = 'sent';
    state.lastTransport = report.transport.balance ?? null;
    writeState(cfg.stateDir, state);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        error: error?.name ?? 'Error',
        message: error?.message ?? String(error),
      }),
    );
    process.exit(exitCodeFor(error));
  });
