/**
 * Erzeugt die Baumappe als echtes PDF — ohne externe Bibliothek, damit die
 * App offline und ohne Build-Schritt bleibt.
 *
 * Aufbau: minimaler PDF-1.4-Writer (Katalog, Seiten, zwei Standardschriften,
 * je Seite ein Content-Stream) plus die Zeichenroutinen fuer Wandplan,
 * Kennzahlen und Listen.
 */

import { CHAIN_COLORS, PROCESSORS } from './data.js';

const A4 = [595.28, 841.89];

/* ----------------------------------------------------------------- Text */

/** WinAnsi-Ersatz fuer Zeichen, die die Standardschrift nicht kennt. */
const REPLACE = {
  '≈': '~', '→': '->', '←': '<-', '″': '"', '′': "'",
  '≤': '<=', '≥': '>=', '⌀': 'D', '‑': '-', ' ': ' ', ' ': ' ',
};

/** Zeichenbreiten in 1/1000 em (Helvetica); Ziffern und Satzzeichen exakt. */
const WIDTHS = { ' ': 278, '.': 278, ',': 278, ':': 278, ';': 278, '!': 278, '|': 260, "'": 191, '"': 355, '(': 333, ')': 333, '-': 333, '/': 278, '%': 889 };
const NARROW = 'ilj';
const WIDE = 'mwMW';

function charWidth(ch) {
  if (ch >= '0' && ch <= '9') return 556;
  if (WIDTHS[ch] !== undefined) return WIDTHS[ch];
  if (NARROW.includes(ch)) return 230;
  if (WIDE.includes(ch)) return 850;
  if (ch >= 'A' && ch <= 'Z') return 700;
  if ('ftr'.includes(ch)) return 333;
  return 550;
}

export function textWidth(text, size, bold = false) {
  let sum = 0;
  for (const ch of String(text)) sum += charWidth(ch);
  return (sum / 1000) * size * (bold ? 1.05 : 1);
}

/** Text in WinAnsi-Bytes uebersetzen und PDF-gerecht escapen. */
function pdfString(text) {
  let out = '';
  for (const ch of String(text)) {
    const mapped = REPLACE[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0);
      if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
      else if (code < 128) out += c;
      else if (code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
      else if (c === '—' || c === '–') out += '\\' + (0x97).toString(8).padStart(3, '0');
      else if (c === '„' || c === '“' || c === '”') out += '"';
      else if (c === '·' || c === '•') out += '\\' + (0xb7).toString(8).padStart(3, '0');
      else if (c === '…') out += '...';
      else out += '?';
    }
  }
  return out;
}

const rgb = (hex) =>
  [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

/* ------------------------------------------------------------- Seiten-API */

/**
 * Zeichenflaeche einer Seite. Alle Koordinaten von oben links in Punkt,
 * intern auf das PDF-Koordinatensystem (unten links) gespiegelt.
 */
class Page {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.ops = [];
  }

  flip(y) { return this.height - y; }

  text(x, y, value, { size = 10, bold = false, color = '#111827', align = 'left', rotate = 0 } = {}) {
    const str = String(value ?? '');
    if (!str) return this;
    const font = `${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${size} Tf`;
    const len = textWidth(str, size, bold);

    if (rotate === 90) {
      // Grundlinie laeuft nach oben, die Glyphen stehen links davon.
      let fy = this.flip(y);
      if (align === 'center') fy -= len / 2;
      else if (align === 'right') fy -= len;
      this.ops.push(`BT ${font} 0 1 -1 0 ${x.toFixed(2)} ${fy.toFixed(2)} Tm (${pdfString(str)}) Tj ET`);
      return this;
    }

    let px = x;
    if (align === 'right') px = x - len;
    else if (align === 'center') px = x - len / 2;
    this.ops.push(
      `BT ${font} 1 0 0 1 ${px.toFixed(2)} ${this.flip(y + size * 0.8).toFixed(2)} Tm (${pdfString(str)}) Tj ET`
    );
    return this;
  }

  rect(x, y, w, h, { fill, stroke, width = 0.7, opacity } = {}) {
    if (w <= 0 || h <= 0) return this;
    if (opacity !== undefined) this.ops.push(`/GS${Math.round(opacity * 100)} gs`);
    const path = `${x.toFixed(2)} ${this.flip(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`;
    if (fill) this.ops.push(`${rgb(fill)} rg`);
    if (stroke) this.ops.push(`${rgb(stroke)} RG ${width} w`);
    this.ops.push(`${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    if (opacity !== undefined) this.ops.push('/GS100 gs');
    return this;
  }

  line(x1, y1, x2, y2, { color = '#94a3b8', width = 0.7, dash } = {}) {
    this.ops.push(`${rgb(color)} RG ${width} w`);
    if (dash) this.ops.push(`[${dash}] 0 d`);
    this.ops.push(`${x1.toFixed(2)} ${this.flip(y1).toFixed(2)} m ${x2.toFixed(2)} ${this.flip(y2).toFixed(2)} l S`);
    if (dash) this.ops.push('[] 0 d');
    return this;
  }

  polyline(points, { color = '#38bdf8', width = 1.2 } = {}) {
    if (points.length < 2) return this;
    const [first, ...rest] = points;
    this.ops.push(`${rgb(color)} RG ${width} w 1 J 1 j`);
    this.ops.push(`${first[0].toFixed(2)} ${this.flip(first[1]).toFixed(2)} m`);
    for (const [x, y] of rest) this.ops.push(`${x.toFixed(2)} ${this.flip(y).toFixed(2)} l`);
    this.ops.push('S');
    return this;
  }

  circle(cx, cy, r, { fill = '#38bdf8' } = {}) {
    const k = r * 0.5523;
    const y = this.flip(cy);
    this.ops.push(`${rgb(fill)} rg`);
    this.ops.push(`${(cx - r).toFixed(2)} ${y.toFixed(2)} m`);
    this.ops.push(`${(cx - r).toFixed(2)} ${(y + k).toFixed(2)} ${(cx - k).toFixed(2)} ${(y + r).toFixed(2)} ${cx.toFixed(2)} ${(y + r).toFixed(2)} c`);
    this.ops.push(`${(cx + k).toFixed(2)} ${(y + r).toFixed(2)} ${(cx + r).toFixed(2)} ${(y + k).toFixed(2)} ${(cx + r).toFixed(2)} ${y.toFixed(2)} c`);
    this.ops.push(`${(cx + r).toFixed(2)} ${(y - k).toFixed(2)} ${(cx + k).toFixed(2)} ${(y - r).toFixed(2)} ${cx.toFixed(2)} ${(y - r).toFixed(2)} c`);
    this.ops.push(`${(cx - k).toFixed(2)} ${(y - r).toFixed(2)} ${(cx - r).toFixed(2)} ${(y - k).toFixed(2)} ${(cx - r).toFixed(2)} ${y.toFixed(2)} c f`);
    return this;
  }

  /** Pfeilspitze am Ende einer Kette. */
  arrow(x, y, dx, dy, size, color) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tipX = x;
    const tipY = y;
    const baseX = x - ux * size;
    const baseY = y - uy * size;
    this.ops.push(`${rgb(color)} rg`);
    this.ops.push(`${tipX.toFixed(2)} ${this.flip(tipY).toFixed(2)} m`);
    this.ops.push(`${(baseX + px * size * 0.45).toFixed(2)} ${this.flip(baseY + py * size * 0.45).toFixed(2)} l`);
    this.ops.push(`${(baseX - px * size * 0.45).toFixed(2)} ${this.flip(baseY - py * size * 0.45).toFixed(2)} l f`);
    return this;
  }

  stream() { return this.ops.join('\n'); }
}

/* --------------------------------------------------------------- Dokument */

function serialize(pages, meta) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  const catalogId = add(null);            // 1, spaeter gefuellt
  const pagesId = add(null);              // 2
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');       // 3
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');  // 4
  const gsId = add('<< /Type /ExtGState /ca 0.22 /CA 1 >>');                                    // 5
  const gsFullId = add('<< /Type /ExtGState /ca 1 /CA 1 >>');                                      // 6

  const pageIds = [];
  for (const page of pages) {
    const content = page.stream();
    const streamId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << /GS22 ${gsId} 0 R /GS100 ${gsFullId} 0 R >> >> ` +
      `/Contents ${streamId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  const infoId = add(
    `<< /Title (${pdfString(meta.title)}) /Author (${pdfString(meta.author)}) ` +
    `/Creator (LED Wall Planner) /CreationDate (${meta.date}) >>`
  );

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const bytes = [];
  const push = (text) => { for (const ch of text) bytes.push(ch.codePointAt(0) & 0xff); };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(bytes.length);
    push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xref = bytes.length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return Uint8Array.from(bytes);
}

/* ------------------------------------------------------------- Bausteine */

const INK = '#111827';
const MUTED = '#5b6675';
const LINE = '#c8d0da';
const ACCENT = '#0b7fab';

/** Zeichnet die Wand mit optionalem Overlay in eine Box (x, y, w, h). */
function drawWall(page, state, calc, overlay, box, { numbers = true } = {}) {
  const m = state.module;
  const { cols, rows } = calc;
  const chains = overlay === 'power' ? calc.powerChains : overlay === 'data' ? calc.dataChains : [];
  const map = new Map();
  chains.forEach((ch, ci) => ch.cells.forEach((cell, pos) => map.set(cell.c + ',' + cell.r, { ci, pos })));

  const scale = Math.min(box.w / (cols * m.w), box.h / (rows * m.h));
  const cw = m.w * scale;
  const chh = m.h * scale;
  const x0 = box.x + (box.w - cols * cw) / 2;
  const y0 = box.y; // oben buendig — darunter folgen die Listen
  const gap = Math.min(cw, chh) * 0.04;
  const font = Math.min(cw, chh) * 0.22;
  const cx = (c) => x0 + c * cw + cw / 2;
  const cy = (r) => y0 + r * chh + chh / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hit = map.get(c + ',' + r);
      const color = hit ? CHAIN_COLORS[hit.ci % CHAIN_COLORS.length] : '#94a3b8';
      page.rect(x0 + c * cw + gap / 2, y0 + r * chh + gap / 2, cw - gap, chh - gap, {
        fill: color, stroke: color, width: 0.6, opacity: 0.22,
      });
      if (numbers && font >= 3.6) {
        page.text(x0 + c * cw + cw * 0.12, y0 + r * chh + chh * 0.1, hit ? `${hit.ci + 1}.${hit.pos + 1}` : `${c + 1}/${r + 1}`,
          { size: font, color: hit ? shade(color) : MUTED });
      }
    }
  }

  chains.forEach((ch, ci) => {
    const color = shade(CHAIN_COLORS[ci % CHAIN_COLORS.length]);
    const pts = ch.cells.map((cell) => [cx(cell.c), cy(cell.r)]);
    page.polyline(pts, { color, width: Math.max(0.8, Math.min(cw, chh) * 0.05) });
    const first = ch.cells[0];
    page.circle(cx(first.c), cy(first.r), Math.max(1.4, Math.min(cw, chh) * 0.1), { fill: color });
    if (pts.length > 1) {
      const [ex, ey] = pts[pts.length - 1];
      const [px, py] = pts[pts.length - 2];
      page.arrow(ex, ey, ex - px, ey - py, Math.max(3, Math.min(cw, chh) * 0.22), color);
    }
    // Kettennummer rechts neben dem Startpunkt — die Modulnummer sitzt links oben.
    const tag = Math.max(5, font * 1.25);
    const text = `${overlay === 'power' ? 'S' : 'P'}${ci + 1}`;
    const offset = Math.min(cw, chh) * 0.16;
    // In der letzten Spalte nach links kippen, damit die Nummer im Bild bleibt.
    const fitsRight = cx(first.c) + offset + textWidth(text, tag, true) <= x0 + cols * cw - 2;
    page.text(fitsRight ? cx(first.c) + offset : cx(first.c) - offset, cy(first.r) - tag * 0.62, text,
      { size: tag, bold: true, color, align: fitsRight ? 'left' : 'right' });
  });

  // Bemassung
  const wallW = cols * cw;
  const wallH = rows * chh;
  page.line(x0, y0 - 10, x0 + wallW, y0 - 10, { color: LINE });
  page.text(x0 + wallW / 2, y0 - 21, `${fmt(calc.widthMm / 1000, 2)} m · ${fmt(calc.resW)} px · ${cols} Module`,
    { size: 8, color: MUTED, align: 'center' });
  page.line(x0 - 12, y0, x0 - 12, y0 + wallH, { color: LINE });
  page.text(x0 - 16, y0 + wallH / 2, `${fmt(calc.heightMm / 1000, 2)} m · ${fmt(calc.resH)} px · ${rows} Module`,
    { size: 8, color: MUTED, align: 'center', rotate: 90 });

  return { x: x0, y: y0, w: wallW, h: wallH };
}

/** Helle Kettenfarben fuer Papier abdunkeln. */
function shade(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const f = 0.62;
  return '#' + [r, g, b].map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('');
}

const fmt = (value, digits = 0) =>
  Number(value).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Zweispaltige Kennzahlenliste. */
function kvBlock(page, x, y, width, title, rows, { size = 9 } = {}) {
  let cursor = y;
  if (title) {
    page.text(x, cursor, title, { size: 10.5, bold: true, color: INK });
    cursor += 15;
  }
  for (const [key, value] of rows) {
    page.text(x, cursor, key, { size, color: MUTED });
    page.text(x + width, cursor, value, { size, bold: true, color: INK, align: 'right' });
    cursor += size + 4.4;
    page.line(x, cursor - 3.2, x + width, cursor - 3.2, { color: '#e6eaf0', width: 0.4 });
  }
  return cursor;
}

/** Spaltenzahl und Zeilen einer Kettenliste — lange Listen werden gedeckelt. */
export function tableShape(count) {
  const columns = count > 24 ? 3 : 2;
  const shown = Math.min(count, 60);
  return { columns, shown, rows: Math.ceil(shown / columns), truncated: count - shown };
}

/** Tabelle der Ketten, bei Bedarf mehrspaltig. */
function chainTable(page, x, y, width, chains, { label, detail }) {
  const shape = tableShape(chains.length);
  const columns = shape.columns;
  const colW = width / columns;
  const perCol = shape.rows;
  chains = chains.slice(0, shape.shown);
  const size = 8.4;
  let maxY = y;
  chains.forEach((ch, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const cx = x + col * colW;
    const cy = y + row * (size + 4.6);
    const color = shade(CHAIN_COLORS[i % CHAIN_COLORS.length]);
    page.rect(cx, cy + 1.5, 6, 6, { fill: color });
    page.text(cx + 10, cy, `${label} ${i + 1}`, { size, bold: true, color: INK });
    page.text(cx + colW - 8, cy, detail(ch), { size, color: MUTED, align: 'right' });
    maxY = Math.max(maxY, cy + size + 4.6);
  });
  if (shape.truncated > 0) {
    page.text(x, maxY + 2, `… und ${shape.truncated} weitere — vollständige Liste im Textexport`, { size: 8, color: MUTED });
    maxY += 14;
  }
  return maxY;
}

/* ----------------------------------------------------------------- Seiten */

function header(page, state, title, subtitle) {
  page.rect(0, 0, page.width, 46, { fill: '#0d1117' });
  page.text(40, 14, state.name || 'LED-Wall', { size: 13, bold: true, color: '#ffffff' });
  page.text(page.width - 40, 16, title, { size: 10.5, bold: true, color: '#7dd3fc', align: 'right' });
  if (subtitle) page.text(40, 30, subtitle, { size: 8.5, color: '#94a3b8' });
}

function footer(page, index, total, dateText) {
  const y = page.height - 28;
  page.line(40, y, page.width - 40, y, { color: LINE, width: 0.5 });
  page.text(40, y + 5, `LED Wall Planner · ${dateText}`, { size: 8, color: MUTED });
  page.text(page.width - 40, y + 5, `Seite ${index} von ${total}`, { size: 8, color: MUTED, align: 'right' });
}

/**
 * Baut die Baumappe.
 * @param {object} state Projekt-State
 * @param {object} calc  Ergebnis aus computeAll()
 * @param {{numbers?:boolean, lists?:boolean, landscape?:boolean}} [opts]
 * @returns {Uint8Array}
 */
export function buildPdf(state, calc, opts = {}) {
  const numbers = opts.numbers !== false;
  const lists = opts.lists !== false;
  const [pw, ph] = opts.landscape ? [A4[1], A4[0]] : A4;
  const M = 40;
  const inner = pw - M * 2;
  const bottom = ph - 54;
  const now = new Date();
  const dateText = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const m = state.module;
  const pages = [];
  const colW = (inner - 24) / 2;
  const rightX = M + colW + 24;

  /* --- Seite 1: Übersicht -------------------------------------------- */
  const p1 = new Page(pw, ph);
  header(p1, state, 'Übersicht', `${m.label} · ${calc.cols} × ${calc.rows} Module · Stand ${dateText}`);
  let y = 72;

  p1.text(M, y, `${fmt(calc.widthMm / 1000, 2)} × ${fmt(calc.heightMm / 1000, 2)} m`, { size: 21, bold: true, color: INK });
  p1.text(M, y + 25, `${fmt(calc.resW)} × ${fmt(calc.resH)} px · ${calc.ratioLabel} · ${fmt(calc.pitch, 2)} mm Pixelabstand · ${fmt(calc.count)} Module`,
    { size: 9.5, color: MUTED });
  y += 48;

  y = Math.max(
    kvBlock(p1, M, y, colW, 'Wand', [
      ['Raster (B × H)', `${calc.cols} × ${calc.rows}`],
      ['Module gesamt', `${fmt(calc.count)}`],
      ['Fläche', `${fmt(calc.areaM2, 2)} m²`],
      ['Diagonale', `${fmt(calc.diagM, 2)} m`],
      ['Bautiefe', `${fmt(m.d)} mm`],
      ['Gewicht gesamt', `${fmt(calc.weight, 1)} kg`],
      ['Last je Meter Breite', `${fmt(calc.weightPerM, 1)} kg/m`],
      ['Gewicht je Spalte', `${fmt(calc.weightPerCol, 1)} kg`],
    ]),
    kvBlock(p1, rightX, y, colW, 'Modul', [
      ['Typ', m.label],
      ['Maß', `${fmt(m.w)} × ${fmt(m.h)} × ${fmt(m.d)} mm`],
      ['Auflösung', `${fmt(m.px)} × ${fmt(m.py)} px`],
      ['Pixelabstand', `${fmt(calc.pitch, 2)} mm`],
      ['Gewicht', `${fmt(m.kg, 1)} kg`],
      ['Leistung ø / max', `${fmt(m.pavg)} / ${fmt(m.pmax)} W`],
      ['Max. Module/Kette', `${fmt(state.signal.maxChain)}`],
      ['Besonderheit', m.note || '—'],
    ])
  ) + 20;

  y = Math.max(
    kvBlock(p1, M, y, colW, 'Signal', [
      ['Processor', PROCESSORS.find((x) => x.id === state.signal.processorId)?.label ?? 'Processor'],
      ['Bildrate', `${calc.hz} Hz`],
      ['Pixel je Port', `${fmt(calc.pxPort)} px`],
      ['Module je Port', `${fmt(calc.maxPerPort)} (Budget ${fmt(calc.perPort)})`],
      ['Begrenzt durch', calc.portLimitedBy],
      ['Ports benötigt', `${fmt(calc.portsNeeded)}`],
      ['Processoren', `${fmt(calc.processors)}`],
      ['Höchste Portlast', `${fmt(calc.portLoad)} %`],
      ['Führung', `${state.signal.orientation === 'v' ? 'Spalten' : 'Zeilen'}${state.signal.serpentine ? ', Schlangenlinie' : ''}`],
    ]),
    kvBlock(p1, rightX, y, colW, 'Strom', [
      ['Leistung maximal', `${fmt(calc.pmax)} W`],
      ['Leistung ø', `${fmt(calc.pavg)} W`],
      ['Leistung je m²', `${fmt(calc.wPerM2Max)} W/m²`],
      ['Netz', `${state.power.volt} V · ${state.power.breaker} A · ${calc.phases}-phasig`],
      ['Belastbarkeit je Kreis', `${fmt(calc.circuitW)} W`],
      ['Stromkreise', `${fmt(calc.circuits)}`],
      ['Module je Kreis', `${fmt(calc.maxPerCircuit)} (Budget ${fmt(calc.perCircuit)})`],
      ['Strom maximal', `${fmt(calc.ampsMax, 1)} A${calc.phases === 3 ? ' je Phase' : ''}`],
      ['Einspeisung', calc.feed || '—'],
    ])
  ) + 20;

  // 16:9-Einpassung
  p1.text(M, y, 'Bildquelle 16:9', { size: 10.5, bold: true, color: INK });
  const f = calc.fitHD;
  const gw = Math.min(colW, 208);
  const gh = (gw * 9) / 16;
  const k = gw / f.canvasW;
  const gy = y + 16;
  p1.rect(M, gy, gw, gh, { fill: '#e2e8f0', stroke: LINE, width: 0.6 });
  p1.rect(M + f.barX * k, gy + f.barY * k, f.contentW * k, f.contentH * k, { fill: ACCENT, stroke: ACCENT, width: 0.8, opacity: 0.22 });
  p1.text(M + gw / 2, gy + gh / 2 - 5, `${fmt(calc.resW)} × ${fmt(calc.resH)}`, { size: 8.5, bold: true, color: ACCENT, align: 'center' });
  p1.text(M, gy + gh + 6, `Grau = schwarze Ränder · ${barText(f)}`, { size: 8, color: MUTED });
  kvBlock(p1, rightX, y, colW, 'Bildquelle & Betrachtung', [
    ['Genutzte Bildfläche', `${fmt(f.usedPct, 1)} %`],
    ['Ränder bei 1920×1080', barText(f)],
    ['Ränder bei 3840×2160', barText(calc.fitUHD)],
    ['Skalierung auf HD', `${fmt(calc.scaleHD * 100)} %`],
    ['Mindestabstand', `${fmt(calc.distMin, 1)} m`],
    ['Voll aufgelöst ab', `${fmt(calc.distRetina, 1)} m`],
  ]);
  pages.push(p1);

  /* --- Seiten 2 und 3: Signal- und Stromplan -------------------------- */
  const planPage = (overlay, title, subtitle, chains, listTitle, label, detail) => {
    const page = new Page(pw, ph);
    header(page, state, title, subtitle);
    const shape = tableShape(chains.length);
    const listH = lists ? shape.rows * 13 + 40 : 0;
    const box = { x: M + 34, y: 96, w: inner - 44, h: bottom - 96 - listH - 20 };
    const rect = drawWall(page, state, calc, overlay, box, { numbers });
    if (lists) {
      const listY = Math.min(rect.y + rect.h + 30, bottom - listH);
      page.text(M, listY, listTitle, { size: 10.5, bold: true, color: INK });
      chainTable(page, M, listY + 18, inner, chains, { label, detail });
    }
    return page;
  };

  pages.push(planPage(
    'data', 'Signalplan',
    `${calc.portsNeeded} Ports · ${fmt(calc.pxPort)} px/Port bei ${calc.hz} Hz · ${state.signal.orientation === 'v' ? 'spaltenweise' : 'zeilenweise'} ab ${cornerText(state.signal.start)}`,
    calc.dataChains, 'Ports', 'Port',
    (ch) => `${ch.cells.length} Module · ${fmt(ch.px)} px · ${fmt((ch.px / calc.pxPort) * 100)} %`
  ));

  pages.push(planPage(
    'power', 'Stromplan',
    `${calc.circuits} Kreise · ${fmt(calc.pmax)} W max · ${state.power.volt} V / ${state.power.breaker} A · ${calc.phases}-phasig`,
    calc.powerChains, 'Stromkreise', 'Kreis',
    (ch) => `${ch.cells.length} Module · ${fmt(Math.round(ch.watt))} W · ${fmt(ch.watt / (state.power.volt || 230), 1)} A`
  ));

  /* --- Seite 4: Modulraster, Notizen, Hinweise ------------------------ */
  const p4 = new Page(pw, ph);
  header(p4, state, 'Modulraster & Notizen', 'Beschriftung Spalte/Zeile — Blick auf die Front');
  const noteLines = wrap(state.notes || '—', inner - 20, 9.5);
  const noteH = Math.max(46, noteLines.length * 13 + 14);
  const tailH = noteH + 16 + 3 * 12 + 34;
  const rasterH = Math.min(360, bottom - 96 - tailH);
  const raster = drawWall(p4, state, calc, 'none', { x: M + 34, y: 96, w: inner - 44, h: rasterH }, { numbers: true });

  let y4 = Math.min(raster.y + raster.h + 28, bottom - tailH);
  p4.text(M, y4, 'Notizen', { size: 10.5, bold: true, color: INK });
  y4 += 16;
  p4.rect(M, y4 - 6, inner, noteH, { fill: '#f8fafc', stroke: LINE, width: 0.5 });
  noteLines.forEach((line, i) => p4.text(M + 10, y4 + 2 + i * 13, line, { size: 9.5, color: INK }));
  y4 += noteH + 12;

  p4.text(M, y4, 'Hinweise', { size: 10.5, bold: true, color: INK });
  y4 += 15;
  for (const line of [
    'Alle Werte sind Richtwerte für die Vorplanung — vor Aufbau die Datenblätter der eingesetzten',
    'Module, Processoren und der Stromverteilung prüfen. Elektrische Arbeiten gehören in Fachhand.',
    'Einschaltstrom beachten: LED-Netzteile ziehen kurzzeitig ein Vielfaches der Nennleistung.',
  ]) {
    p4.text(M, y4, line, { size: 8.6, color: MUTED });
    y4 += 12;
  }
  pages.push(p4);

  pages.forEach((page, i) => footer(page, i + 1, pages.length, dateText));

  return serialize(pages, {
    title: `${state.name} — LED-Wall Baumappe`,
    author: 'LED Wall Planner',
    date: pdfDate(now),
  });
}

const CORNERS = { tl: 'oben links', tr: 'oben rechts', bl: 'unten links', br: 'unten rechts' };
const cornerText = (id) => CORNERS[id] ?? id;

const barText = (f) =>
  f.mode === 'letterbox' ? `oben/unten je ${fmt(f.barY)} px`
    : f.mode === 'pillarbox' ? `links/rechts je ${fmt(f.barX)} px`
      : 'keine';

/** Zeilenumbruch anhand der geschaetzten Textbreite. */
function wrap(text, width, size) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) > width && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out.slice(0, 24);
}

const pdfDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
