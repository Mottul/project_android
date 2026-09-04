/** Zeichnet die LED-Wand als SVG: Raster, Datenpfade, Stromgruppen, Masse. */

import { CHAIN_COLORS } from './data.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = new Intl.NumberFormat('de-DE');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const meters = (mm) => (mm / 1000).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const chainColor = (i) => CHAIN_COLORS[i % CHAIN_COLORS.length];

/**
 * @param {object} state  Projekt-State
 * @param {object} calc   Ergebnis aus computeAll()
 * @param {{standalone?:boolean}} [opts] standalone = eigenstaendige Datei zum Export
 */
export function renderWall(state, calc, opts = {}) {
  const p = state.panel;
  const { cols, rows } = calc;
  const overlay = state.view.overlay; // 'none' | 'data' | 'power'
  const chains = overlay === 'power' ? calc.powerChains : overlay === 'data' ? calc.dataChains : [];

  // Zuordnung Zelle -> Kette/Position, damit Beschriftung und Farbe passen.
  const map = new Map();
  chains.forEach((ch, ci) => ch.cells.forEach((cell, pos) => map.set(cell.c + ',' + cell.r, { ci, pos })));

  const unit = Math.min(p.w, p.h);
  const gap = unit * 0.035;
  const pad = state.view.dims ? unit * 1.15 : unit * 0.2;
  const W = cols * p.w;
  const H = rows * p.h;
  const font = unit * 0.24;
  const stroke = unit * 0.055;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" ` +
      `role="img" aria-label="Grundriss der LED-Wand, ${cols} mal ${rows} Panels" class="wall-svg">`
  );
  // Je Farbe ein eigener Pfeil-Marker — `context-stroke` ist nicht ueberall verfuegbar.
  const markers = CHAIN_COLORS.map(
    (col, i) =>
      `<marker id="ar${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`
  ).join('');
  parts.push(`<defs>${markers}</defs>`);
  if (opts.standalone) parts.push(`<rect x="${-pad}" y="${-pad}" width="${W + pad * 2}" height="${H + pad * 2}" fill="#0d1117"/>`);

  // --- Panels ------------------------------------------------------------
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hit = map.get(c + ',' + r);
      const col = hit ? chainColor(hit.ci) : '#64748b';
      const fill = hit ? col : '#1e293b';
      parts.push(
        `<rect x="${c * p.w + gap / 2}" y="${r * p.h + gap / 2}" width="${p.w - gap}" height="${p.h - gap}" ` +
          `rx="${unit * 0.04}" fill="${fill}" fill-opacity="${hit ? 0.22 : 0.9}" stroke="${col}" stroke-opacity="0.75" stroke-width="${stroke}"/>`
      );
      if (state.view.numbers) {
        const label = hit ? `${hit.ci + 1}.${hit.pos + 1}` : `${c + 1}/${r + 1}`;
        parts.push(
          `<text x="${c * p.w + unit * 0.16}" y="${r * p.h + unit * 0.3}" dominant-baseline="central" ` +
            `font-family="system-ui, sans-serif" font-size="${font}" fill="${hit ? col : '#94a3b8'}">${label}</text>`
        );
      }
    }
  }

  // --- Ketten (Daten- oder Stromweg) -------------------------------------
  chains.forEach((ch, ci) => {
    const col = chainColor(ci);
    const pts = ch.cells.map((cell) => `${cell.c * p.w + p.w / 2},${cell.r * p.h + p.h / 2}`);
    if (pts.length > 1) {
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${stroke * 1.5}" ` +
          `stroke-linejoin="round" stroke-linecap="round" stroke-opacity="0.95" marker-end="url(#ar${ci % CHAIN_COLORS.length})"/>`
      );
    }
    const first = ch.cells[0];
    parts.push(
      `<circle cx="${first.c * p.w + p.w / 2}" cy="${first.r * p.h + p.h / 2}" r="${unit * 0.13}" fill="${col}"/>`
    );
    parts.push(
      `<text x="${first.c * p.w + p.w / 2}" y="${first.r * p.h + p.h / 2 - unit * 0.3}" text-anchor="middle" ` +
        `font-family="system-ui, sans-serif" font-weight="700" font-size="${font * 1.25}" fill="${col}" ` +
        `paint-order="stroke" stroke="#0d1117" stroke-width="${unit * 0.05}" stroke-linejoin="round">` +
        `${overlay === 'power' ? 'S' : 'P'}${ci + 1}</text>`
    );
  });

  // --- Bemassung ---------------------------------------------------------
  if (state.view.dims) {
    const tick = unit * 0.18;
    const y = -pad * 0.55;
    parts.push(
      `<path d="M0 ${y - tick} V${y + tick} M0 ${y} H${W} M${W} ${y - tick} V${y + tick}" stroke="#94a3b8" stroke-width="${stroke}" fill="none"/>`
    );
    parts.push(
      `<text x="${W / 2}" y="${y - tick * 1.6}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
        `font-size="${font * 1.15}" fill="#cbd5e1">${meters(W)} m · ${nf.format(calc.resW)} px · ${cols} Panels</text>`
    );
    const x = -pad * 0.55;
    parts.push(
      `<path d="M${x - tick} 0 H${x + tick} M${x} 0 V${H} M${x - tick} ${H} H${x + tick}" stroke="#94a3b8" stroke-width="${stroke}" fill="none"/>`
    );
    parts.push(
      `<text x="${x - tick * 1.6}" y="${H / 2}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
        `font-size="${font * 1.15}" fill="#cbd5e1" transform="rotate(-90 ${x - tick * 1.6} ${H / 2})">` +
        `${meters(H)} m · ${nf.format(calc.resH)} px · ${rows} Panels</text>`
    );
  }

  if (opts.standalone) {
    parts.push(
      `<text x="0" y="${H + pad * 0.7}" font-family="system-ui, sans-serif" font-size="${font}" fill="#64748b">` +
        `${esc(state.name)} · ${esc(p.label)} · ${overlay === 'power' ? 'Stromgruppen' : overlay === 'data' ? 'Signalwege' : 'Raster'}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

/** Legende zu den Ketten als HTML (Farbe, Umfang, Auslastung). */
export function renderLegend(state, calc) {
  const overlay = state.view.overlay;
  if (overlay === 'none') return '<p class="hint">Overlay ausgeschaltet — es wird nur das Panelraster gezeigt.</p>';

  const isPower = overlay === 'power';
  const chains = isPower ? calc.powerChains : calc.dataChains;
  const rows = chains
    .map((ch, i) => {
      const detail = isPower
        ? `${nf.format(Math.round(ch.watt))} W · ${(ch.watt / (state.power.volt || 230)).toFixed(1)} A`
        : `${nf.format(ch.px)} px · ${Math.round((ch.px / Math.max(1, state.signal.pxPort)) * 100)} %`;
      return (
        `<li><span class="dot" style="background:${chainColor(i)}"></span>` +
        `<strong>${isPower ? 'Stromkreis' : 'Port'} ${i + 1}</strong>` +
        `<span>${ch.cells.length} Panels · ${detail}</span></li>`
      );
    })
    .join('');
  return `<ul class="legend">${rows}</ul>`;
}
