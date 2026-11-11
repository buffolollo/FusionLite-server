/**
 * Gestione fuso orario Europe/Rome (o qualunque IANA) senza dipendenze.
 *
 * Tutte le date del report sono date locali (stringhe "YYYY-MM-DD"), mentre
 * l'API FusionSolar vuole:
 *   - queryTime: epoch millis della mezzanotte locale;
 *   - timeZone:  offset in ore SENZA segno "+" ("1", "2", "5.5", "-5");
 *   - timeZoneStr: identificativo IANA ("Europe/Rome");
 *   - header x-timezone-offset: "+0100".
 *
 * Questi tre formati sono diversi apposta e non vanno confusi.
 */

const FORMATTERS = new Map();

function formatter(timeZone) {
  let fmt = FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

export function normalizeTimeZone(timeZone) {
  const value = String(timeZone ?? '').trim();
  if (!value) throw new Error('TIMEZONE mancante');
  try {
    formatter(value).format(new Date());
  } catch {
    throw new Error(`TIMEZONE non valido: "${value}" (es. Europe/Rome)`);
  }
  return value;
}

export function zonedParts(instant, timeZone) {
  const values = {};
  for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
    values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Offset del fuso (in millisecondi, positivo a est) nell'istante dato. */
function offsetMsAt(instant, timeZone) {
  const seconds = Math.floor(instant / 1000) * 1000;
  const p = zonedParts(seconds, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - seconds;
}

/** Mezzanotte locale della data "YYYY-MM-DD" come epoch millis. */
export function startOfDay(dateStr, timeZone) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = wallClockAsUtc;
  for (let i = 0; i < 4; i++) {
    const next = wallClockAsUtc - offsetMsAt(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** Offset in ore nel formato richiesto dall'API: "2", "1", "5.5", "-5". */
export function tzOffsetHours(instant, timeZone) {
  const hours = offsetMsAt(instant, timeZone) / 3600000;
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Offset per l'header x-timezone-offset: "+0100" / "-0530". */
export function tzHeaderOffset(instant, timeZone) {
  const offset = offsetMsAt(instant, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  return `${sign}${pad2(hours)}${pad2(minutes)}`;
}

/** Data locale "YYYY-MM-DD" di un istante. */
export function localDateString(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "YYYY-MM-DD" + N giorni (aritmetica in UTC, sicura sui cambi d'ora). */
export function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Etichette italiane ricavate dalla sola data (nessun fuso: è già locale). */
export function italianDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const opts = { timeZone: 'UTC' };
  const short = new Intl.DateTimeFormat('it-IT', {
    ...opts,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(noonUtc);
  const long = new Intl.DateTimeFormat('it-IT', {
    ...opts,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(noonUtc);
  const monthLabel = new Intl.DateTimeFormat('it-IT', {
    ...opts,
    month: 'long',
    year: 'numeric',
  }).format(noonUtc);
  return { short, long, month: monthLabel };
}

/** Numeri in formato italiano: 12,4 / 1.234,5 / 43 %. */
export function itNumber(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function itPercent(ratio, digits = 0) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${itNumber(ratio * 100, digits)} %`;
}

export function itDateTime(instant, timeZone) {
  const date = new Intl.DateTimeFormat('it-IT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(instant));
  return `${date} alle ${itTime(instant, timeZone)}`;
}

export function itTime(instant, timeZone) {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}
