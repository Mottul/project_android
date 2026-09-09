/**
 * Datenmodell der OSC-Steuerung: Bedienelemente ("Widgets"), Seiten, Projekte.
 *
 * Ein PROJEKT buendelt mehrere SEITEN. Jede Seite ist ein Raster mit `columns`
 * Spalten; jedes Widget belegt darin ein Rechteck (gx/gy = Zelle links oben,
 * cw/ch = Spanne). Widgets ueberlappen sich nie. Live-Werte werden mitgespeichert,
 * damit die Oberflaeche nach dem Neustart aussieht wie vorher.
 *
 * Reine Daten + reine Funktionen — kein DOM, damit alles testbar bleibt.
 */

export const MODEL_VERSION = 1;

export const MIN_COLS = 4;
export const MAX_COLS = 24;
export const DEFAULT_COLS = 12;
export const MAX_ROWS = 40;

export const COLORS = [
  '#38bdf8', '#22c55e', '#eab308', '#f97316',
  '#ef4444', '#ec4899', '#a78bfa', '#14b8a6',
  '#94a3b8', '#f5f5f5',
];

/** Alle Bauteile mit Anzeigename, Kurzbeschreibung und Standardgroesse. */
export const TYPES = {
  fader:  { name: 'Fader',    hint: 'Regler, zieht relativ',            cw: 3, ch: 6, min: { cw: 2, ch: 3 } },
  knob:   { name: 'Poti',     hint: 'Drehregler, auch endlos',          cw: 3, ch: 4, min: { cw: 2, ch: 3 } },
  toggle: { name: 'Schalter', hint: 'rastet ein und aus',               cw: 4, ch: 2, min: { cw: 2, ch: 1 } },
  button: { name: 'Taster',   hint: 'sendet beim Druecken und Loslassen', cw: 4, ch: 2, min: { cw: 2, ch: 1 } },
  bank:   { name: 'Bank',     hint: 'Feld aus mehreren Tastern',        cw: 12, ch: 4, min: { cw: 3, ch: 2 } },
  select: { name: 'Auswahl',  hint: 'eine Option aus mehreren',         cw: 6, ch: 4, min: { cw: 3, ch: 2 } },
  xy:     { name: 'XY-Pad',   hint: 'zwei Werte auf einer Flaeche',     cw: 6, ch: 5, min: { cw: 3, ch: 3 } },
  color:  { name: 'Farbe',    hint: 'RGB (+ Deckkraft)',                cw: 6, ch: 6, min: { cw: 4, ch: 4 } },
  label:  { name: 'Text',     hint: 'Beschriftung ohne Funktion',       cw: 12, ch: 1, min: { cw: 2, ch: 1 } },
  meter:  { name: 'Anzeige',  hint: 'zeigt eingehendes Feedback',       cw: 6, ch: 3, min: { cw: 3, ch: 2 } },
};

/** Reihenfolge in der Bauteil-Palette. */
export const TYPE_ORDER = ['fader', 'knob', 'toggle', 'button', 'bank', 'select', 'xy', 'color', 'meter', 'label'];

let seq = 0;
export function uid(prefix = 'w') {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    seq += 1;
    return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);

function clampInt(v, lo, hi, fallback = lo) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), lo, hi);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------- Widgets --- */

/** Neues Bedienelement mit sinnvollen Vorgaben. */
export function makeWidget(type = 'fader', over = {}) {
  const t = TYPES[type] ? type : 'fader';
  const size = TYPES[t];
  const w = {
    id: uid(),
    type: t,
    label: size.name,
    color: COLORS[0],
    address: '/mottul/' + t,
    addressY: '',
    argType: 'f',          // 'f' = Kommazahl, 'i' = Ganzzahl
    min: 0,
    max: 1,
    onValue: 1,
    offValue: 0,
    gx: -1, gy: -1,        // -1 = noch nicht platziert
    cw: size.cw, ch: size.ch,
    // Live-Zustand
    value: 0,
    x: 0.5, y: 0.5,
    r: 1, g: 1, b: 1, a: 1,
    text: '',
    // Typ-spezifisch
    items: [],
    orient: 'v',           // Fader/Farbe: Ausrichtung
    cols: 0,               // Bank/Auswahl: Spalten (0 = automatisch)
    bankMode: 'momentary', // Bank: 'momentary' | 'toggle'
    endless: false,        // Poti: Endlos-Encoder
    align: 'left',         // Text: Ausrichtung
    source: 'number',      // Anzeige: 'number' | 'text'
    ...over,
  };
  if (t === 'toggle' || t === 'button') { w.cw = over.cw ?? size.cw; w.ch = over.ch ?? size.ch; }
  if (t === 'xy' && !w.addressY) w.addressY = '';
  return w;
}

/** Mindestgroesse eines Typs (Rasterzellen). */
export const minSize = (type) => (TYPES[type] || TYPES.fader).min;

/** Fehlende/kaputte Felder auffuellen — schuetzt vor alten oder fremden Dateien. */
export function normalizeWidget(raw) {
  const type = TYPES[raw?.type] ? raw.type : 'fader';
  const base = makeWidget(type);
  const w = { ...base, ...(raw || {}), type, id: raw?.id || base.id };
  w.label = String(w.label ?? '');
  w.color = /^#[0-9a-f]{6}$/i.test(String(w.color)) ? w.color : base.color;
  w.address = String(w.address || base.address);
  w.addressY = String(w.addressY || '');
  w.argType = w.argType === 'i' ? 'i' : 'f';
  w.min = num(w.min, 0);
  w.max = num(w.max, 1);
  if (w.min === w.max) w.max = w.min + 1;
  w.onValue = num(w.onValue, 1);
  w.offValue = num(w.offValue, 0);
  w.value = clamp(num(w.value, w.min), Math.min(w.min, w.max), Math.max(w.min, w.max));
  w.x = clamp01(num(w.x, 0.5));
  w.y = clamp01(num(w.y, 0.5));
  w.r = clamp01(num(w.r, 1));
  w.g = clamp01(num(w.g, 1));
  w.b = clamp01(num(w.b, 1));
  w.a = clamp01(num(w.a, 1));
  w.text = String(w.text ?? '');
  w.orient = w.orient === 'h' ? 'h' : 'v';
  w.cols = clampInt(w.cols, 0, 12, 0);
  w.bankMode = w.bankMode === 'toggle' ? 'toggle' : 'momentary';
  w.endless = !!w.endless;
  w.align = ['left', 'center', 'right'].includes(w.align) ? w.align : 'left';
  w.source = w.source === 'text' ? 'text' : 'number';
  w.items = Array.isArray(w.items)
    ? w.items.slice(0, 64).map((it) => ({
        label: String(it?.label ?? ''),
        address: String(it?.address ?? ''),
        value: num(it?.value, 0),
      }))
    : [];
  const m = minSize(type);
  w.cw = clampInt(w.cw, m.cw, MAX_COLS, base.cw);
  w.ch = clampInt(w.ch, m.ch, MAX_ROWS, base.ch);
  w.gx = Number.isFinite(Number(raw?.gx)) ? Math.max(-1, Math.round(Number(raw.gx))) : -1;
  w.gy = Number.isFinite(Number(raw?.gy)) ? Math.max(-1, Math.round(Number(raw.gy))) : -1;
  return w;
}

/* --------------------------------------------------------------- Seiten --- */

export function makePage(name = 'Seite 1', over = {}) {
  return { id: uid('p'), name, columns: DEFAULT_COLS, fit: true, widgets: [], ...over };
}

export function normalizePage(raw) {
  const p = { ...makePage(), ...(raw || {}) };
  p.id = raw?.id || p.id;
  p.name = String(p.name || 'Seite');
  p.columns = clampInt(p.columns, MIN_COLS, MAX_COLS, DEFAULT_COLS);
  p.fit = raw?.fit !== false;
  p.widgets = Array.isArray(raw?.widgets) ? raw.widgets.map(normalizeWidget) : [];
  for (const w of p.widgets) w.cw = Math.min(w.cw, p.columns);
  placeMissing(p.widgets, p.columns);
  return p;
}

export function makeProject(name = 'Projekt', pages) {
  const list = pages && pages.length ? pages : [makePage()];
  return { id: uid('pr'), version: MODEL_VERSION, name, pages: list, currentPageId: list[0].id };
}

export function normalizeProject(raw) {
  const pages = Array.isArray(raw?.pages) && raw.pages.length
    ? raw.pages.slice(0, 24).map(normalizePage)
    : [makePage()];
  const p = {
    id: raw?.id || uid('pr'),
    version: MODEL_VERSION,
    name: String(raw?.name || 'Projekt'),
    pages,
    currentPageId: pages.some((x) => x.id === raw?.currentPageId) ? raw.currentPageId : pages[0].id,
  };
  return p;
}

/* ---------------------------------------------------------------- Raster --- */

/** Ueberlappen sich zwei Rechtecke im Raster? */
export function overlaps(a, b) {
  return a.gx < b.gx + b.cw && b.gx < a.gx + a.cw && a.gy < b.gy + b.ch && b.gy < a.gy + a.ch;
}

/** Passt das Rechteck an dieser Stelle (im Raster und ohne Kollision)? */
export function fits(rect, widgets, columns, ignoreId = null) {
  if (rect.gx < 0 || rect.gy < 0 || rect.gx + rect.cw > columns) return false;
  return !widgets.some((w) => w.id !== ignoreId && w.id !== rect.id && overlaps(rect, w));
}

/** Erste freie Stelle fuer ein Rechteck der Groesse cw x ch (zeilenweise). */
export function findSlot(widgets, columns, cw, ch) {
  const width = Math.min(cw, columns);
  for (let gy = 0; gy < MAX_ROWS * 2; gy += 1) {
    for (let gx = 0; gx + width <= columns; gx += 1) {
      if (fits({ gx, gy, cw: width, ch }, widgets, columns)) return { gx, gy };
    }
  }
  return { gx: 0, gy: 0 };
}

/** Allen Widgets ohne Position (gx/gy < 0) eine freie Stelle geben. */
export function placeMissing(widgets, columns) {
  const placed = widgets.filter((w) => w.gx >= 0 && w.gy >= 0);
  for (const w of widgets) {
    if (w.gx >= 0 && w.gy >= 0) continue;
    w.cw = Math.min(w.cw, columns);
    const slot = findSlot(placed, columns, w.cw, w.ch);
    w.gx = slot.gx;
    w.gy = slot.gy;
    placed.push(w);
  }
  return widgets;
}

/** Alles nach oben schieben, Luecken schliessen (Reihenfolge bleibt erhalten). */
export function compact(widgets, columns) {
  const sorted = [...widgets].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  const done = [];
  for (const w of sorted) {
    let gy = w.gy;
    while (gy > 0 && fits({ ...w, gy: gy - 1 }, done, columns, w.id)) gy -= 1;
    w.gy = gy;
    done.push(w);
  }
  return widgets;
}

/** Neu anordnen: alle Widgets in ihrer Reihenfolge dicht packen. */
export function autoArrange(widgets, columns) {
  const order = [...widgets].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  const placed = [];
  for (const w of order) {
    w.cw = Math.min(w.cw, columns);
    const slot = findSlot(placed, columns, w.cw, w.ch);
    w.gx = slot.gx;
    w.gy = slot.gy;
    placed.push(w);
  }
  return widgets;
}

/**
 * Ein Widget an eine Stelle setzen — auch wenn dort schon etwas liegt: alle
 * anderen weichen nach unten aus. Ohne das koennte man auf einer vollen Seite
 * nichts mehr verschieben.
 * @returns {Array} dieselbe Widget-Liste, ueberschneidungsfrei
 */
export function dropAt(widgets, columns, widget, rect) {
  widget.gx = clamp(Math.round(rect.gx), 0, Math.max(0, columns - rect.cw));
  widget.gy = Math.max(0, Math.round(rect.gy));
  widget.cw = clamp(Math.round(rect.cw), minSize(widget.type).cw, columns);
  widget.ch = clamp(Math.round(rect.ch), minSize(widget.type).ch, MAX_ROWS);

  const placed = [widget];
  const others = widgets.filter((w) => w.id !== widget.id).sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  for (const o of others) {
    let guard = 0;
    while (!fits(o, placed, columns, o.id) && guard < MAX_ROWS * 4) { o.gy += 1; guard += 1; }
    placed.push(o);
  }
  return widgets;
}

/** Anzahl belegter Rasterzeilen (fuer „auf Bildschirm einpassen"). */
export function usedRows(widgets) {
  return widgets.reduce((max, w) => Math.max(max, w.gy + w.ch), 0);
}

/**
 * Spaltenzahl aendern: relative Positionen bleiben erhalten, danach wird
 * neu gepackt, falls etwas kollidiert.
 */
export function rescale(page, columns) {
  const factor = columns / page.columns;
  for (const w of page.widgets) {
    w.gx = clamp(Math.round(w.gx * factor), 0, columns - 1);
    w.cw = clamp(Math.max(1, Math.round(w.cw * factor)), minSize(w.type).cw, columns);
    if (w.gx + w.cw > columns) w.gx = columns - w.cw;
    if (w.gx < 0) { w.gx = 0; w.cw = columns; }
  }
  page.columns = columns;
  // Kollisionen aufloesen: nach unten schieben, dann verdichten.
  const placed = [];
  for (const w of [...page.widgets].sort((a, b) => a.gy - b.gy || a.gx - b.gx)) {
    while (!fits(w, placed, columns, w.id)) w.gy += 1;
    placed.push(w);
  }
  compact(page.widgets, columns);
  return page;
}
