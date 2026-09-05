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
  const p = state.module;
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
      `role="img" aria-label="Grundriss der LED-Wand, ${cols} mal ${rows} Module" class="wall-svg">`
  );
  // Je Farbe ein eigener Pfeil-Marker — `context-stroke` ist nicht ueberall verfuegbar.
  const markers = CHAIN_COLORS.map(
    (col, i) =>
      `<marker id="ar${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${col}"/></marker>`
  ).join('');
  parts.push(`<defs>${markers}</defs>`);
  if (opts.standalone) parts.push(`<rect x="${-pad}" y="${-pad}" width="${W + pad * 2}" height="${H + pad * 2}" fill="#0d1117"/>`);

  // --- Module -------------------------------------------------------------
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
        `font-size="${font * 1.15}" fill="#cbd5e1">${meters(W)} m · ${nf.format(calc.resW)} px · ${plural(cols, 'Modul', 'Module')}</text>`
    );
    const x = -pad * 0.55;
    parts.push(
      `<path d="M${x - tick} 0 H${x + tick} M${x} 0 V${H} M${x - tick} ${H} H${x + tick}" stroke="#94a3b8" stroke-width="${stroke}" fill="none"/>`
    );
    parts.push(
      `<text x="${x - tick * 1.6}" y="${H / 2}" text-anchor="middle" font-family="system-ui, sans-serif" ` +
        `font-size="${font * 1.15}" fill="#cbd5e1" transform="rotate(-90 ${x - tick * 1.6} ${H / 2})">` +
        `${meters(H)} m · ${nf.format(calc.resH)} px · ${plural(rows, 'Modul', 'Module')}</text>`
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
  if (overlay === 'none') return '<p class="hint">Overlay ausgeschaltet — es wird nur das Modulraster gezeigt.</p>';

  const isPower = overlay === 'power';
  const chains = isPower ? calc.powerChains : calc.dataChains;
  const rows = chains
    .map((ch, i) => {
      const detail = isPower
        ? `${nf.format(Math.round(ch.watt))} W · ${(ch.watt / (state.power.volt || 230)).toFixed(1)} A`
        : `${nf.format(ch.px)} px · ${Math.round((ch.px / Math.max(1, calc.pxPort)) * 100)} %`;
      return (
        `<li><span class="dot" style="background:${chainColor(i)}"></span>` +
        `<strong>${isPower ? 'Stromkreis' : 'Port'} ${i + 1}</strong>` +
        `<span>${ch.cells.length} Module · ${detail}</span></li>`
      );
    })
    .join('');
  return `<ul class="legend">${rows}</ul>`;
}

/**
 * Zeigt, wie das Wandformat in ein 16:9-Bild passt und wo schwarze Raender
 * entstehen. Massstab: das 1920×1080-Raster auf 320×180 Einheiten verkleinert.
 */
export function renderFit(calc) {
  const f = calc.fitHD;
  const k = 320 / f.canvasW; // Skalierung ins Zeichenfeld
  const cw = f.contentW * k;
  const ch = f.contentH * k;
  const bx = f.barX * k;
  const by = f.barY * k;
  const label = `${nf.format(calc.resW)} × ${nf.format(calc.resH)} px · ${calc.ratioLabel}`;

  const bar = (x, y, w, h, text, vertical) => {
    if (w < 0.5 || h < 0.5) return '';
    const cx = x + w / 2;
    const cy = y + h / 2;
    const t = vertical
      ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="9" fill="#fca5a5" ` +
        `transform="rotate(-90 ${cx} ${cy})">${text}</text>`
      : `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="9" fill="#fca5a5">${text}</text>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000"/>${w > 30 && h > 12 ? t : ''}`;
  };

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -18 328 218" font-family="system-ui, sans-serif" `,
    `role="img" aria-label="Einpassung des Wandformats in ein 16:9-Bild">`,
    `<text x="0" y="-5" font-size="10" fill="#8b98a9">16:9-Bildquelle · 1920 × 1080 px</text>`,
    `<rect x="0" y="0" width="320" height="180" fill="#1e293b" stroke="#64748b" stroke-width="1" stroke-dasharray="4 3"/>`,
    bar(0, 0, 320, by, `${nf.format(f.barY)} px`, false),
    bar(0, 180 - by, 320, by, `${nf.format(f.barY)} px`, false),
    bar(0, 0, bx, 180, `${nf.format(f.barX)} px`, true),
    bar(320 - bx, 0, bx, 180, `${nf.format(f.barX)} px`, true),
    `<rect x="${bx}" y="${by}" width="${cw}" height="${ch}" fill="#38bdf8" fill-opacity=".2" stroke="#38bdf8" stroke-width="1.5"/>`,
    `<text x="160" y="90" text-anchor="middle" dominant-baseline="central" font-size="${labelSize(label, cw)}" fill="#38bdf8" font-weight="600">${label}</text>`,
    `<text x="0" y="194" font-size="9.5" fill="#8b98a9">${fitWord(f)} · ${nf.format(f.usedPct)} % der Bildfläche genutzt</text>`,
    `</svg>`,
  ].join('');
}

/** Schrift verkleinern, wenn das Format schmal ist. */
const labelSize = (label, width) => Math.max(6, Math.min(11, (width - 8) / (label.length * 0.52)));

const fitWord = (f) =>
  f.mode === 'letterbox' ? `Balken oben und unten je ${nf.format(f.barY)} px`
    : f.mode === 'pillarbox' ? `Balken links und rechts je ${nf.format(f.barX)} px`
      : 'formatfüllend, keine Balken';
