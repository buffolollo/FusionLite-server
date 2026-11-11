/**
 * Dati dimostrativi per --demo.
 * Servono solo a controllare l'aspetto dell'email senza credenziali.
 */

export function demoInput(date) {
  const labels = [];
  const production = [];
  const consumption = [];
  const exported = [];
  const imported = [];
  const selfUse = [];
  const charge = [];
  const discharge = [];

  for (let index = 0; index < 96; index++) {
    const hour = index / 4;
    const hours = String(Math.floor(hour)).padStart(2, '0');
    const minutes = String((index % 4) * 15).padStart(2, '0');
    labels.push(`${hours}:${minutes}`);

    const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const pv = 4.2 * Math.pow(sun, 1.3) * (0.96 + 0.04 * Math.sin(index));
    const use =
      0.35 +
      1.5 * Math.exp(-Math.pow((hour - 7.5) / 1.6, 2)) +
      1.9 * Math.exp(-Math.pow((hour - 19.5) / 2.2, 2));

    production.push(Number(pv.toFixed(2)));
    consumption.push(Number(use.toFixed(2)));
    exported.push(Number(Math.max(0, pv - use * 0.6).toFixed(2)));
    imported.push(Number(Math.max(0, use - pv * 0.5).toFixed(2)));
    selfUse.push(Number(Math.min(pv, use).toFixed(2)));
    // Valori plausibili per una batteria domestica (la serie reale sarebbe
    // la potenza effettiva di carica/scarica, non il semplice surplus).
    charge.push(Number((Math.max(0, pv - use) * 0.12).toFixed(3)));
    discharge.push(Number((Math.max(0, use - pv) * 0.16).toFixed(3)));
  }

  const dayOfMonth = Number(date.slice(8, 10)) || 1;
  const monthValues = [];
  for (let day = 1; day <= dayOfMonth; day++) {
    const value = 8 + 5 * Math.sin(day * 0.9) + 3 * Math.cos(day * 0.35);
    monthValues.push(Number(Math.max(0.6, value).toFixed(2)));
  }
  monthValues[monthValues.length - 1] = 12.4;
  const monthTotal = Number(monthValues.reduce((total, value) => total + value, 0).toFixed(2));

  return {
    date,
    tz: 'Europe/Rome',
    generatedAt: Date.now(),
    station: {
      dn: 'NE=DEMO0000000000',
      name: 'Casa Rossi',
      installedCapacity: '6.0',
    },
    kpi: {
      dailyEnergy: '12.4',
      dailyIncome: '3.10',
      currency: '€',
      isPriceConfigured: true,
      existMeter: true,
    },
    day: {
      xAxis: labels,
      productPower: production,
      usePower: consumption,
      onGridPower: exported,
      buyPower: imported,
      selfUsePower: selfUse,
      chargePower: charge,
      dischargePower: discharge,
      totalProductPower: '12.4',
      totalUsePower: '18.2',
      totalOnGridPower: '4.5',
      totalBuyPower: '10.3',
      totalSelfUsePower: '7.9',
    },
    month: {
      xAxis: monthValues.map((_, index) => String(index + 1).padStart(2, '0')),
      productPower: monthValues,
      totalProductPower: String(monthTotal),
      totalUsePower: '160.2',
      totalSelfUsePower: '61.0',
    },
    tariffs: { buy: 25, sell: 12 },
    currency: '€',
    transport: { balance: 'v1 POST', kpi: 'KPI POST', station: 'POST' },
  };
}
