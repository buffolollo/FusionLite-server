/**
 * Conversione numerica tollerante.
 *
 * FusionSolar alterna numeri e stringhe ("3.42", "3,42", "3420 W",
 * "1.234,5"), quindi lo stesso valore va normalizzato prima di ogni calcolo.
 * La logica segue data/FlowMetrics.kt dell'app (parseNum) con in più la
 * gestione del separatore delle migliaia.
 */

export function num(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string') return null;

  let text = value.trim();
  if (!text) return null;

  // Unità: W -> kW, Wh -> kWh (solo se non c'è già la "k").
  const lower = text.toLowerCase();
  const isKilowatt = /\bkw\b/.test(lower);
  const isWatt = !isKilowatt && /\bw\b/.test(lower);
  const isKilowattHour = /\bkwh\b/.test(lower);
  const isWattHour = !isKilowattHour && /\bwh\b/.test(lower);

  // Normalizza i separatori: virgola decimale italiana o migliaia.
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    // "1,234" è più probabilmente un migliaio; "12,5" un decimale.
    if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, '');
    else text = text.replace(',', '.');
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let result = Number(match[0]);
  if (!Number.isFinite(result)) return null;

  if (isWatt) result /= 1000;
  if (isWattHour) result /= 1000;
  return result;
}

/** "25", "25.5", "25,5" -> 25.5 ; vuoto -> null ; non valido -> null. */
export function parseCents(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Alcuni host restituiscono un id numerico di valuta ("4") invece del codice.
 * In quel caso è meglio non stampare nulla (stessa regola di
 * data/Tariffs.kt → usableCurrency).
 */
export function usableCurrency(currency) {
  const value = String(currency ?? '').trim();
  if (!value) return null;
  if (/^[\d.+-]+$/.test(value)) return null;
  return value;
}
