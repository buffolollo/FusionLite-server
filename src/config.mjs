/**
 * Lettura della configurazione.
 *
 * Il file .env viene caricato direttamente qui (senza --env-file): funziona
 * anche lanciando `node src/main.mjs` a mano. Le variabili già presenti
 * nell'ambiente hanno la precedenza.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors.mjs';
import { parseCents } from './num.mjs';
import { normalizeTimeZone } from './tz.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const VAR_DIR = path.join(ROOT, 'var');

const ENV_FILE = path.join(ROOT, '.env');
const CA_FILE = path.join(ROOT, 'ca', 'huawei_equipment_ca.cer');

export function loadEnvFile(file = ENV_FILE) {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    let key = line.slice(0, separator).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cents(value, name, errors) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = parseCents(raw);
  if (parsed == null) {
    errors.push(`${name} non valido: "${raw}" (usa un numero, es. 25 oppure 25,5)`);
    return null;
  }
  return parsed;
}

/** Divide "a@x.it, b@y.it" (o con ";") in indirizzi distinti. */
function emailList(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** Configurazione grezza, senza validazione (utile a --check e --demo). */
export function readConfig() {
  const env = process.env;
  const to = text(env.REPORT_TO);
  const to2 = text(env.REPORT_TO_2);
  return {
    authHost: text(env.FUSIONSOLAR_AUTH_HOST)
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '') || 'intl.fusionsolar.huawei.com',
    authPort: text(env.FUSIONSOLAR_AUTH_PORT) || '32800',
    user: text(env.FUSIONSOLAR_USER),
    password: typeof env.FUSIONSOLAR_PASSWORD === 'string' ? env.FUSIONSOLAR_PASSWORD : '',
    appClientId: text(env.APP_CLIENT_ID),
    plantName: text(env.PLANT_NAME),
    plantDn: text(env.PLANT_DN),
    timezone: text(env.TIMEZONE) || 'Europe/Rome',
    currency: text(env.REPORT_CURRENCY) || '€',
    buyCents: parseCents(env.REPORT_BUY_CENTS),
    sellCents: parseCents(env.REPORT_SELL_CENTS),
    to,
    to2,
    // REPORT_TO può già contenere più indirizzi separati da virgola; qui si
    // aggiunge il secondo campo e si tolgono i duplicati.
    recipients: [...new Set([...emailList(to), ...emailList(to2)])],
    gmailUser: text(env.GMAIL_USER),
    gmailAppPassword: text(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''),
    mailFrom: text(env.MAIL_FROM) || text(env.GMAIL_USER),
    caPath: CA_FILE,
    stateDir: VAR_DIR,
  };
}

/** Campi necessari per inviare l'email (servono anche a --demo --test-email). */
export function validateMail(cfg) {
  const errors = [];
  if (!cfg.recipients?.length) {
    errors.push('Manca REPORT_TO (destinatario del report; oppure REPORT_TO_2)');
  }
  for (const address of cfg.recipients ?? []) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      errors.push(`Indirizzo email non valido: ${address}`);
    }
  }
  if (!cfg.gmailUser) errors.push('Manca GMAIL_USER (account Gmail mittente)');
  if (!cfg.gmailAppPassword) {
    errors.push('Manca GMAIL_APP_PASSWORD (password per le app di Google)');
  }
  if (cfg.gmailAppPassword && cfg.gmailAppPassword.length < 12) {
    errors.push('GMAIL_APP_PASSWORD sembra troppo corta (16 lettere, senza spazi)');
  }
  return errors;
}

/**
 * Tutti i campi necessari a produrre e inviare il report reale.
 * Con requireMail=false (usato da --dry-run) i campi Gmail non servono.
 */
export function validateConfig(cfg, { requireMail = true } = {}) {
  const errors = [];
  if (!cfg.user) errors.push('Manca FUSIONSOLAR_USER (utente FusionSolar)');
  if (!cfg.password) errors.push('Manca FUSIONSOLAR_PASSWORD (password FusionSolar)');
  if (!cfg.plantDn && !cfg.plantName) {
    errors.push('Indica PLANT_NAME oppure PLANT_DN (impianto da riportare)');
  }
  if (cfg.authHost.includes(' ') || cfg.authHost.includes('/')) {
    errors.push(`FUSIONSOLAR_AUTH_HOST non valido: "${cfg.authHost}"`);
  }
  if (!/^\d+$/.test(cfg.authPort)) {
    errors.push(`FUSIONSOLAR_AUTH_PORT non valido: "${cfg.authPort}"`);
  }
  try {
    normalizeTimeZone(cfg.timezone);
  } catch (error) {
    errors.push(error.message);
  }
  if (!fs.existsSync(cfg.caPath)) {
    errors.push(`CA Huawei mancante: ${cfg.caPath} (copiala da FusionLite/app/src/main/assets/)`);
  }
  if (cfg.appClientId && !/^[0-9a-fA-F]{32}$/.test(cfg.appClientId)) {
    errors.push('APP_CLIENT_ID deve essere di 32 caratteri esadecimali');
  }
  if (text(process.env.REPORT_BUY_CENTS) && cfg.buyCents == null) {
    errors.push('REPORT_BUY_CENTS non valido (usa un numero, es. 25 oppure 25,5)');
  }
  if (text(process.env.REPORT_SELL_CENTS) && cfg.sellCents == null) {
    errors.push('REPORT_SELL_CENTS non valido (usa un numero, es. 12 oppure 12,5)');
  }
  if (requireMail) errors.push(...validateMail(cfg));
  return errors;
}

export function loadConfig({ requireAll = true, requireMail = true } = {}) {
  loadEnvFile();
  const cfg = readConfig();
  const errors = validateConfig(cfg, { requireMail });
  if (requireAll && errors.length) {
    throw new ConfigError(errors.map((line) => `- ${line}`).join('\n'));
  }
  return cfg;
}

/** Valori mascherati per --check: niente segreti a schermo o nei log. */
export function describeConfig(cfg) {
  const mask = (value) => {
    if (!value) return '(vuoto)';
    if (value.length <= 4) return '***';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  };
  return [
    `FUSIONSOLAR_USER       ${cfg.user || '(vuoto)'}`,
    `FUSIONSOLAR_AUTH_HOST  ${cfg.authHost}:${cfg.authPort}`,
    `FUSIONSOLAR_PASSWORD   ${mask(cfg.password)}`,
    `APP_CLIENT_ID          ${cfg.appClientId || '(generato in var/state.json)'}`,
    `PLANT_NAME             ${cfg.plantName || '(vuoto)'}`,
    `PLANT_DN               ${cfg.plantDn || '(vuoto)'}`,
    `TIMEZONE               ${cfg.timezone}`,
    `REPORT_BUY_CENTS       ${cfg.buyCents ?? '(non impostato)'}`,
    `REPORT_SELL_CENTS      ${cfg.sellCents ?? '(non impostato)'}`,
    `GMAIL_USER             ${cfg.gmailUser || '(vuoto)'}`,
    `GMAIL_APP_PASSWORD     ${mask(cfg.gmailAppPassword)}`,
    `REPORT_TO              ${cfg.to || '(vuoto)'}`,
    `REPORT_TO_2            ${cfg.to2 || '(vuoto)'}`,
    `DESTINATARI            ${cfg.recipients.join(', ') || '(nessuno)'}`,
    `MAIL_FROM              ${cfg.mailFrom || '(vuoto)'}`,
    `CA Huawei              ${fs.existsSync(cfg.caPath) ? cfg.caPath : '(MANCANTE)'}`,
  ].join('\n');
}

export { ConfigError };
