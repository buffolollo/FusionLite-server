/**
 * Da risposte grezze FusionSolar al modello del report.
 *
 * Nota sulle unità (come in FusionLite/data/Statistics.kt):
 *  - la serie del GIORNO è potenza istantanea in kW;
 *  - la serie del MESE è energia giornaliera in kWh.
 * Per il giorno l'energia si prende dai totali del server (o dal KPI
 * ufficiale); solo se mancano si integra la curva (potenza × intervallo) e il
 * report lo dichiara apertamente.
 */

import { num, usableCurrency } from './num.mjs';
import { italianDate } from './tz.mjs';

const HOURS = 24;

function series(values) {
  return Array.isArray(values) ? values.map(num) : [];
}

function sum(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function integral(values, intervalHours) {
  return sum(values) * intervalHours;
}

function timeOf(label) {
  const match = String(label ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function hourOf(label) {
  const time = timeOf(label);
  if (!time) return null;
  return Number(time.slice(0, 2));
}

/** Intervallo fra due punti della serie (dai label "HH:mm"), in ore. */
function intervalHours(labels) {
  const minutes = labels
    .map(timeOf)
    .filter(Boolean)
    .map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));

  if (minutes.length < 3) {
    const count = Math.max(1, labels.length || 96);
    return 24 / count;
  }

  const deltas = [];
  for (let i = 1; i < minutes.length; i++) {
    let delta = minutes[i] - minutes[i - 1];
    if (delta <= 0) delta += 24 * 60;
    deltas.push(delta);
  }
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.max(1, median) / 60;
}

/** Media oraria (kW) su 24 slot; se mancano gli orari distribuisce i punti. */
function hourly(values, labels) {
  const totals = new Array(HOURS).fill(0);
  const counts = new Array(HOURS).fill(0);
  if (!values.length) return totals;

  const hours = values.map((_, index) => hourOf(labels[index]));
  if (hours.every((hour) => hour != null)) {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value == null) continue;
      totals[hours[i]] += value;
      counts[hours[i]] += 1;
    }
  } else {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (value == null) continue;
      const hour = Math.min(HOURS - 1, Math.floor((i * HOURS) / values.length));
      totals[hour] += value;
      counts[hour] += 1;
    }
  }
  return totals.map((value, index) => (counts[index] ? value / counts[index] : 0));
}

function dayEnergy(total, values, interval, fallback = null) {
  const direct = num(total);
  if (direct != null) return { value: direct, source: 'total' };
  if (fallback != null) return { value: fallback, source: 'kpi' };
  if (!values.length) return { value: null, source: 'missing' };
  return { value: integral(values, interval), source: 'estimated' };
}

/**
 * Totale del mese fino al giorno del report.
 *
 * Il server restituisce il mese intero (con i giorni futuri a "--"): per il
 * report di ieri va tagliato al giorno richiesto, altrimenti la media
 * giornaliera includerebbe oggi. I label sono "01".."31" oppure date intere.
 */
function monthTotalFor(month, date) {
  const labels = Array.isArray(month?.xAxis) ? month.xAxis : [];
  const values = series(month?.productPower);
  const dayNumber = Number(date.slice(8, 10));

  if (values.length) {
    let index = labels.findIndex((label) => {
      const text = String(label ?? '').trim();
      return (
        text === String(dayNumber).padStart(2, '0') ||
        text === String(dayNumber) ||
        text === date ||
        text.endsWith(date)
      );
    });
    if (index < 0 && values.length >= dayNumber) index = dayNumber - 1;
    if (index >= 0 && index < values.length) {
      const total = sum(values.slice(0, index + 1));
      if (Number.isFinite(total)) return total;
    }
  }
  return num(month?.totalProductPower);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return clamp01(numerator / denominator);
}

export function buildReport(input) {
  const {
    station = {},
    kpi = null,
    day = null,
    month = null,
    date,
    today = null,
    tz,
    tariffs = {},
    currency,
    generatedAt = Date.now(),
    transport = {},
  } = input;

  const warnings = [];
  const labels = Array.isArray(day?.xAxis) ? day.xAxis : [];

  const productionSeries = series(day?.productPower);
  const useSeries = series(day?.usePower);
  const exportSeries = series(day?.onGridPower);
  const importSeries = series(day?.buyPower);
  const selfUseSeries = series(day?.selfUsePower);
  const chargeSeries = series(day?.chargePower);
  const dischargeSeries = series(day?.dischargePower);

  const interval = intervalHours(labels);

  // --- Produzione ----------------------------------------------------------
  // `station-real-kpi` restituisce SEMPRE i valori di oggi, anche con un
  // queryTime passato (verificato sul campo l'11/11/2026). Per i giorni
  // passati l'unica fonte corretta è energy-balance, i cui totali sono kWh
  // esatti; il KPI resta solo come fallback per il giorno corrente.
  const kpiIsToday = today != null && date === today;
  const kpiDaily = kpiIsToday ? num(kpi?.dailyEnergy) : null;
  const serverTotal = num(day?.totalProductPower);
  const integrated = productionSeries.length
    ? integral(productionSeries, interval)
    : null;

  let production;
  let productionSource;
  if (serverTotal != null) {
    production = serverTotal;
    productionSource = 'total';
  } else if (kpiDaily != null) {
    production = kpiDaily;
    productionSource = 'kpi';
  } else if (integrated != null) {
    production = integrated;
    productionSource = 'estimated';
  } else {
    production = 0;
    productionSource = 'missing';
  }

  const consumption = dayEnergy(
    day?.totalUsePower,
    useSeries,
    interval,
    kpiIsToday ? num(kpi?.dailyUseEnergy) : null,
  );
  const exported = dayEnergy(day?.totalOnGridPower, exportSeries, interval);
  const imported = dayEnergy(day?.totalBuyPower, importSeries, interval);
  const selfUsed = dayEnergy(
    day?.totalSelfUsePower,
    selfUseSeries,
    interval,
    kpiIsToday ? num(kpi?.dailySelfUseEnergy) : null,
  );

  // --- Picco di potenza ----------------------------------------------------
  let peakKw = null;
  let peakTime = null;
  for (let i = 0; i < productionSeries.length; i++) {
    const value = productionSeries[i];
    if (value != null && (peakKw == null || value > peakKw)) {
      peakKw = value;
      peakTime = timeOf(labels[i]);
    }
  }

  // --- Batteria ------------------------------------------------------------
  const charge = day ? integral(chargeSeries, interval) : null;
  const discharge = day ? integral(dischargeSeries, interval) : null;
  const cycles =
    charge != null && discharge != null ? (charge + discharge) / 2 : null;

  // --- Mese in corso -------------------------------------------------------
  const monthTotal = monthTotalFor(month, date);
  const mtdDays = Number(date.slice(8, 10));
  const monthlyAverage =
    monthTotal != null && mtdDays > 0 ? monthTotal / mtdDays : null;
  const vsAverage =
    monthlyAverage != null && monthlyAverage > 0
      ? ((production - monthlyAverage) / monthlyAverage) * 100
      : null;
  const monthSelfSufficiency = ratio(
    num(month?.totalSelfUsePower) ?? 0,
    num(month?.totalUsePower) ?? 0,
  );

  // --- Costi (solo se l'utente ha impostato i prezzi) ----------------------
  let costs = null;
  const costBasisReady =
    consumption.value != null &&
    imported.value != null &&
    exported.value != null &&
    selfUsed.value != null;
  if (costBasisReady && (tariffs.buy != null || tariffs.sell != null)) {
    const buy = tariffs.buy ?? 0;
    const sell = tariffs.sell ?? 0;
    const importCost = (imported.value * buy) / 100;
    const exportRevenue = (exported.value * sell) / 100;
    costs = {
      buyCents: buy,
      sellCents: sell,
      consumptionCost: (consumption.value * buy) / 100,
      importCost,
      exportRevenue,
      selfUseSavings: (selfUsed.value * buy) / 100,
      net: importCost - exportRevenue,
    };
  }

  // --- Note ----------------------------------------------------------------
  if (productionSource === 'estimated') {
    warnings.push(
      'Produzione stimata dalla curva di potenza: il dato ufficiale del giorno non è disponibile.',
    );
  }
  if (productionSource === 'missing') {
    warnings.push('Produzione non disponibile per il giorno richiesto.');
  }
  if (kpiIsToday && !kpi) warnings.push('KPI giornaliero non disponibile.');
  if (!month) warnings.push('Dati del mese non disponibili.');
  if (transport.balance && transport.balance !== 'v1 POST') {
    warnings.push(`Trasporto dati alternativo usato per le serie: ${transport.balance}.`);
  }
  if (kpiIsToday && transport.kpi && transport.kpi !== 'KPI POST') {
    warnings.push(`KPI letto con ${transport.kpi}.`);
  }

  const productionHours = hourly(productionSeries, labels);
  const consumptionHours = hourly(useSeries, labels);
  const maxHour = Math.max(1e-6, ...productionHours, ...consumptionHours);

  // installedCapacity è spesso "0.0": la potenza reale dell'impianto è in
  // onlyInverterPower (osservato: 0.0 contro 3.0).
  const capacityKwp =
    [num(station.installedCapacity), num(station.onlyInverterPower)].find(
      (value) => value != null && value > 0,
    ) ?? null;

  return {
    date,
    dateLabel: italianDate(date),
    timezone: tz,
    plant: {
      name: station.name ?? 'Impianto',
      dn: station.dn ?? null,
      capacityKwp,
    },
    production: { kwh: production, source: productionSource },
    consumption,
    export: exported,
    import: imported,
    selfUse: selfUsed,
    selfSufficiency: ratio(selfUsed.value, consumption.value),
    selfConsumption: ratio(selfUsed.value, production),
    peak: { kw: peakKw, time: peakTime },
    specificYield: capacityKwp > 0 ? production / capacityKwp : null,
    battery: { charge, discharge, cycles },
    hasChart: productionSeries.length > 0 || useSeries.length > 0,
    hours: {
      production: productionHours,
      consumption: consumptionHours,
      max: maxHour,
    },
    month: {
      label: italianDate(date).month,
      total: monthTotal,
      days: mtdDays,
      average: monthlyAverage,
      vsAverage,
      selfSufficiency: monthSelfSufficiency,
    },
    costs,
    currency: usableCurrency(kpi?.currency) ?? currency ?? '€',
    warnings,
    generatedAt,
    transport,
  };
}
