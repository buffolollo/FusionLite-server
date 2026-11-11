/**
 * Renderer dell'email.
 *
 * Vincoli Gmail (veri, non teorici): niente <style>, niente flex/grid, niente
 * SVG né immagini data-URI. Tutto è fatto di tabelle annidate e stili inline,
 * così il report si vede uguale in Gmail web e sull'app mobile.
 */

import { itDateTime, itNumber, itPercent } from './tz.mjs';

const COLORS = {
  ink: '#1c2b23',
  inkSoft: '#3f5148',
  muted: '#6f7f77',
  faint: '#93a19a',
  line: '#e3ebe6',
  surface: '#ffffff',
  surfaceSoft: '#f6f9f7',
  page: '#eef2f0',
  green: '#2f9e68',
  greenDark: '#0f3d2e',
  greenSoft: '#dff1e7',
  amber: '#e8a32b',
  amberSoft: '#fdf1d8',
  dangerSoft: '#fdecea',
  danger: '#a33a2a',
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function kwh(value) {
  return value == null ? '—' : `${itNumber(value, 1)} kWh`;
}

function kw(value) {
  return value == null ? '—' : `${itNumber(value, 1)} kW`;
}

function pct(value) {
  return value == null ? '—' : itPercent(value, 0);
}

function money(value, currency) {
  return value == null ? '—' : `${currency} ${itNumber(value, 2)}`;
}

function kpiCard(label, value, hint = '') {
  return `
    <div style="background:${COLORS.surfaceSoft};border:1px solid ${COLORS.line};border-radius:12px;padding:14px 16px;">
      <div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:${COLORS.muted};font-weight:700;">${esc(label)}</div>
      <div style="font-size:20px;line-height:1.25;font-weight:700;color:${COLORS.ink};margin-top:5px;">${esc(value)}</div>
      ${hint ? `<div style="font-size:11px;color:${COLORS.faint};margin-top:2px;">${esc(hint)}</div>` : ''}
    </div>`;
}

function bars(values, max, color) {
  return values
    .map((value) => {
      const height = value > 0 ? Math.max(2, Math.round((value / max) * 106)) : 2;
      const background = value > 0 ? color : '#e9efec';
      return `<td style="width:4.1666%;padding:0 1px;vertical-align:bottom;"><div style="height:${height}px;background:${background};border-radius:2px 2px 0 0;font-size:0;line-height:0;">&nbsp;</div></td>`;
    })
    .join('');
}

function sectionTitle(title, subtitle = '') {
  return `
    <div style="font-size:15px;font-weight:700;color:${COLORS.greenDark};">${esc(title)}</div>
    ${subtitle ? `<div style="font-size:12px;color:${COLORS.muted};margin-top:2px;">${esc(subtitle)}</div>` : ''}`;
}

function miniStat(label, value) {
  return `
    <td width="33.33%" style="vertical-align:top;padding:0 6px;">
      <div style="font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:${COLORS.muted};font-weight:700;">${esc(label)}</div>
      <div style="font-size:17px;font-weight:700;color:${COLORS.ink};margin-top:3px;">${esc(value)}</div>
    </td>`;
}

function warningBox(warnings) {
  if (!warnings.length) return '';
  return `
    <tr>
      <td style="padding:18px 32px 0 32px;">
        <div style="background:#fffaf0;border:1px solid #f1dfb4;border-radius:12px;padding:13px 16px;">
          <div style="font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:#8a5a00;font-weight:700;">Note</div>
          <ul style="margin:7px 0 0;padding-left:18px;color:#6d5a2a;font-size:12px;line-height:1.55;">
            ${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}
          </ul>
        </div>
      </td>
    </tr>`;
}

function costsBlock(report) {
  if (!report.costs) return '';
  const c = report.costs;
  const currency = report.currency;
  const rows = [
    ['Costo del consumo', money(c.consumptionCost, currency)],
    ['Costo del prelievo', money(c.importCost, currency)],
    ['Ricavo da immissione', money(c.exportRevenue, currency)],
    ['Risparmio da autoconsumo', money(c.selfUseSavings, currency)],
  ];
  return `
    <tr>
      <td style="padding:22px 32px 0 32px;">
        ${sectionTitle('Costi', 'Prezzi impostati manualmente')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:collapse;">
          ${rows
            .map(
              ([label, value]) => `
            <tr>
              <td style="padding:7px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;color:${COLORS.inkSoft};">${esc(label)}</td>
              <td align="right" style="padding:7px 0;border-bottom:1px solid ${COLORS.line};font-size:13px;color:${COLORS.ink};font-weight:600;">${esc(value)}</td>
            </tr>`,
            )
            .join('')}
          <tr>
            <td style="padding:10px 0 0;font-size:13px;font-weight:700;color:${COLORS.ink};">Importo netto</td>
            <td align="right" style="padding:10px 0 0;font-size:15px;font-weight:800;color:${COLORS.greenDark};">${esc(money(c.net, currency))}</td>
          </tr>
        </table>
        <div style="font-size:11px;color:${COLORS.faint};margin-top:8px;">
          Acquisto ${esc(itNumber(c.buyCents, 1))} cent/kWh · vendita ${esc(itNumber(c.sellCents, 1))} cent/kWh.
          L'importo netto è il costo del prelievo meno il ricavo da immissione.
        </div>
      </td>
    </tr>`;
}

function chartBlock(report) {
  if (!report.hasChart) return '';
  return `
    <tr>
      <td style="padding:26px 32px 0 32px;">
        ${sectionTitle('Curva di potenza', 'kW · media oraria')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
          <tr>
            <td style="font-size:11px;color:${COLORS.muted};padding-bottom:6px;">
              <span style="display:inline-block;width:8px;height:8px;background:${COLORS.green};border-radius:2px;margin-right:5px;"></span>Produzione
              <span style="display:inline-block;width:8px;height:8px;background:${COLORS.amber};border-radius:2px;margin-left:14px;margin-right:5px;"></span>Consumo
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${COLORS.surfaceSoft};border:1px solid ${COLORS.line};border-radius:10px;">
          <tr><td style="padding:12px 12px 0 12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>${bars(report.hours.production, report.hours.max, COLORS.green)}</tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:4px;">
              <tr>${bars(report.hours.consumption, report.hours.max, COLORS.amber)}</tr>
            </table>
          </td></tr>
          <tr><td style="padding:6px 12px 10px 12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                ${['00', '03', '06', '09', '12', '15', '18', '21']
                  .map(
                    (hour, index) =>
                      `<td width="12.5%" align="${index === 0 ? 'left' : index === 7 ? 'right' : 'center'}" style="font-size:10px;color:${COLORS.faint};">${hour}</td>`,
                  )
                  .join('')}
              </tr>
            </table>
          </td></tr>
        </table>
      </td>
    </tr>`;
}

function batteryBlock(report) {
  if (report.battery.charge == null && report.battery.discharge == null) return '';
  return `
    <tr>
      <td style="padding:24px 32px 0 32px;">
        ${sectionTitle('Batteria', 'Energia scambiata nella giornata')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
          <tr>
            ${miniStat('Carica', kwh(report.battery.charge))}
            ${miniStat('Scarica', kwh(report.battery.discharge))}
            ${miniStat('Cicli stimati', itNumber(report.battery.cycles, 2))}
          </tr>
        </table>
      </td>
    </tr>`;
}

export function renderHtml(report, { demo = false } = {}) {
  const today = itDateTime(report.generatedAt, report.timezone);
  const peakText =
    report.peak.kw == null
      ? 'picco non disponibile'
      : `picco ${kw(report.peak.kw)}${report.peak.time ? ` alle ${report.peak.time}` : ''}`;
  const yieldText =
    report.specificYield == null
      ? ''
      : ` · resa specifica ${itNumber(report.specificYield, 2)} kWh/kWp`;
  const capacityText =
    report.plant.capacityKwp == null
      ? ''
      : `Potenza installata ${itNumber(report.plant.capacityKwp, 1)} kWp`;

  const thirdMonthStat =
    report.month.vsAverage == null
      ? miniStat('Autosufficienza mese', pct(report.month.selfSufficiency))
      : miniStat(
          'Ieri vs media',
          `${report.month.vsAverage >= 0 ? '+' : ''}${itNumber(report.month.vsAverage, 0)} %`,
        );

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Report ${esc(report.plant.name)} · ${esc(report.dateLabel.short)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
  Ieri ${esc(kwh(report.production.kwh))} prodotti, ${esc(kwh(report.consumption.value))} consumati.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:${COLORS.surface};border-radius:16px;overflow:hidden;font-family:${FONT};color:${COLORS.ink};">
        ${
          demo
            ? `<tr><td style="background:${COLORS.amberSoft};color:#7a5200;padding:10px 16px;text-align:center;font-size:12px;font-weight:700;">ANTEPRIMA — dati dimostrativi, nessun dato reale</td></tr>`
            : ''
        }

        <!-- Intestazione -->
        <tr>
          <td style="background:${COLORS.greenDark};padding:28px 32px 26px 32px;">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8fd3b0;font-weight:700;">Riepilogo giornaliero</div>
            <div style="font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;margin-top:7px;">${esc(report.plant.name)}</div>
            <div style="font-size:13px;color:#bcd9cb;margin-top:5px;">${esc(report.dateLabel.long)}</div>
            ${capacityText ? `<div style="font-size:12px;color:#8fb8a4;margin-top:3px;">${esc(capacityText)}</div>` : ''}
          </td>
        </tr>

        <!-- Produzione -->
        <tr>
          <td style="padding:28px 32px 6px 32px;">
            <div style="font-size:13px;color:${COLORS.muted};">Ieri il tuo impianto ha prodotto</div>
            <div style="font-size:42px;line-height:1.1;font-weight:800;color:${COLORS.greenDark};margin-top:4px;">
              ${esc(itNumber(report.production.kwh, 1))}
              <span style="font-size:18px;font-weight:600;color:${COLORS.muted};">kWh</span>
            </div>
            <div style="font-size:12px;color:${COLORS.muted};margin-top:6px;">${esc(`${peakText}${yieldText}`)}</div>
          </td>
        </tr>

        <!-- KPI -->
        <tr>
          <td style="padding:14px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
              <tr>
                <td width="50%" style="padding:0 6px 12px 0;">${kpiCard('Consumo', kwh(report.consumption.value))}</td>
                <td width="50%" style="padding:0 0 12px 6px;">${kpiCard('Autoconsumo', kwh(report.selfUse.value))}</td>
              </tr>
              <tr>
                <td width="50%" style="padding:0 6px 12px 0;">${kpiCard('Immissione in rete', kwh(report.export.value))}</td>
                <td width="50%" style="padding:0 0 12px 6px;">${kpiCard('Prelievo dalla rete', kwh(report.import.value))}</td>
              </tr>
              <tr>
                <td width="50%" style="padding:0 6px 0 0;">${kpiCard('Autosufficienza', pct(report.selfSufficiency), 'autoconsumo sul consumo')}</td>
                <td width="50%" style="padding:0 0 0 6px;">${kpiCard('Quota autoconsumo', pct(report.selfConsumption), 'autoconsumo sulla produzione')}</td>
              </tr>
            </table>
          </td>
        </tr>

        ${chartBlock(report)}

        <!-- Mese -->
        <tr>
          <td style="padding:24px 32px 0 32px;">
            ${sectionTitle('Mese in corso', report.month.label)}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
              <tr>
                ${miniStat('Totale', kwh(report.month.total))}
                ${miniStat('Media giornaliera', kwh(report.month.average))}
                ${thirdMonthStat}
              </tr>
            </table>
          </td>
        </tr>

        ${batteryBlock(report)}
        ${costsBlock(report)}
        ${warningBox(report.warnings)}

        <!-- Piede -->
        <tr>
          <td style="padding:24px 32px 26px 32px;">
            <div style="border-top:1px solid ${COLORS.line};padding-top:14px;font-size:11px;line-height:1.65;color:${COLORS.faint};">
              Report generato automaticamente il ${esc(today)} (${esc(report.timezone)}).<br>
              Fonte: FusionLite · impianto &quot;${esc(report.plant.name)}&quot;.
              ${report.production.source === 'estimated' ? '<br>Produzione stimata dalla curva di potenza.' : ''}
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderText(report, { demo = false } = {}) {
  const lines = [];
  if (demo) lines.push('*** ANTEPRIMA — dati dimostrativi ***', '');
  lines.push(`RIEPILOGO GIORNALIERO — ${report.plant.name}`);
  lines.push(report.dateLabel.long);
  if (report.plant.capacityKwp != null) {
    lines.push(`Potenza installata: ${itNumber(report.plant.capacityKwp, 1)} kWp`);
  }
  lines.push('');
  lines.push(`Produzione:          ${kwh(report.production.kwh)}`);
  lines.push(`Consumo:             ${kwh(report.consumption.value)}`);
  lines.push(`Autoconsumo:         ${kwh(report.selfUse.value)}`);
  lines.push(`Immissione in rete:  ${kwh(report.export.value)}`);
  lines.push(`Prelievo dalla rete: ${kwh(report.import.value)}`);
  lines.push(`Autosufficienza:     ${pct(report.selfSufficiency)}`);
  lines.push(`Quota autoconsumo:   ${pct(report.selfConsumption)}`);
  lines.push(
    `Picco di potenza:    ${kw(report.peak.kw)}${report.peak.time ? ` alle ${report.peak.time}` : ''}`,
  );
  if (report.specificYield != null) {
    lines.push(`Resa specifica:      ${itNumber(report.specificYield, 2)} kWh/kWp`);
  }
  lines.push('');
  lines.push('Batteria');
  lines.push(`  Carica:  ${kwh(report.battery.charge)}`);
  lines.push(`  Scarica: ${kwh(report.battery.discharge)}`);
  lines.push(`  Cicli:   ${itNumber(report.battery.cycles, 2)}`);
  lines.push('');
  lines.push(`Mese in corso (${report.month.label})`);
  lines.push(`  Totale:            ${kwh(report.month.total)}`);
  lines.push(`  Media giornaliera: ${kwh(report.month.average)}`);
  if (report.month.vsAverage != null) {
    lines.push(
      `  Ieri vs media:     ${report.month.vsAverage >= 0 ? '+' : ''}${itNumber(report.month.vsAverage, 0)} %`,
    );
  } else {
    lines.push(`  Autosufficienza:   ${pct(report.month.selfSufficiency)}`);
  }

  if (report.costs) {
    const c = report.costs;
    lines.push('');
    lines.push('Costi');
    lines.push(`  Costo del consumo:         ${money(c.consumptionCost, report.currency)}`);
    lines.push(`  Costo del prelievo:        ${money(c.importCost, report.currency)}`);
    lines.push(`  Ricavo da immissione:      ${money(c.exportRevenue, report.currency)}`);
    lines.push(`  Risparmio da autoconsumo:  ${money(c.selfUseSavings, report.currency)}`);
    lines.push(`  Importo netto:             ${money(c.net, report.currency)}`);
  }

  if (report.warnings.length) {
    lines.push('');
    lines.push('Note');
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }

  lines.push('');
  lines.push(
    `Report generato automaticamente il ${itDateTime(report.generatedAt, report.timezone)} (${report.timezone}).`,
  );
  lines.push(`Fonte: FusionLite · impianto "${report.plant.name}".`);
  return lines.join('\n');
}
