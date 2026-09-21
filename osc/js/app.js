/**
 * OSC Pad — Zusammenbau: Ansicht, Seiten, Verbindung, Monitor, Speichern.
 *
 * Die Blaetter (Sheets) bilden einen kleinen Stapel: aus dem Menue geht es in
 * ein Unterblatt, der Pfeil links fuehrt zurueck. Dadurch bleibt jedes Blatt
 * kurz und man findet sich auch mit einer Hand zurecht.
 */

import {
  makeWidget, makePage, normalizePage, normalizeProject, autoArrange, dropAt, placeCopy,
  usedRows, recolumn, findSlot, clamp, minSize, TYPES, TYPE_ORDER, MIN_COLS, MAX_COLS, MAX_ROWS,
} from './model.js';
import { PRESETS, buildPreset, starterProject } from './presets.js';
import { createWidget, setHaptics } from './widgets.js';
import { attachEditing, buildInspector, duplicateWidget } from './editor.js';
import { typeIcon, uiIcon } from './icons.js';
import { createLink, defaultBridgeUrl } from './conn.js';
import { formatMessage } from './osc.js';
import {
  loadProject, saveProject, loadSettings, saveSettings,
  loadLibrary, storeInLibrary, removeFromLibrary,
} from './store.js';

export const APP_VERSION = '1.8.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let project = loadProject();
let settings = loadSettings();
let mode = 'live';
let selectedId = null;
let pendingSlot = null;      // Zelle, in die das naechste Bauteil soll
let instances = new Map();   // widget-id -> Instanz
let byAddress = new Map();   // OSC-Adresse -> [Instanz]
const logBuf = [];
let logDirty = false;
let wakeLock = null;

const surface = $('#surface');
const pageTabs = $('#pageTabs');

const currentPage = () => project.pages.find((p) => p.id === project.currentPageId) || project.pages[0];
const persist = () => saveProject(project);

/* ------------------------------------------------------------ Verbindung -- */

const link = createLink({
  onState: (s) => paintConnection(s),
  onFeedback: (m) => {
    const list = byAddress.get(m.address);
    if (!list) return;
    for (const inst of list) inst.feedback(m.args, m.types, m.address);
  },
  onLog: (entry) => {
    logBuf.push(entry);
    if (logBuf.length > 300) logBuf.splice(0, logBuf.length - 300);
    if (!logDirty) { logDirty = true; requestAnimationFrame(renderLog); }
  },
});

const STATUS_TEXT = { off: 'getrennt', connecting: 'verbinde …', open: 'verbunden', error: 'Fehler' };

function paintConnection(s) {
  const dot = $('#connDot');
  dot.className = 'dot' + (s.status === 'open' ? ' on' : s.status === 'connecting' ? ' wait' : s.status === 'error' ? ' err' : '');
  $('#connLat').textContent = s.status === 'open'
    ? (s.latency == null ? 'ok' : `${s.latency} ms`)
    : s.status === 'connecting' ? '…' : 'aus';

  const mi = $('#miConn');
  if (mi) mi.textContent = `${STATUS_TEXT[s.status]} · Ziel ${s.target.host}:${s.target.port}`;

  const box = $('#connBox');
  if (!box) return;
  box.replaceChildren();
  const line = (k, v) => {
    const d = document.createElement('div');
    const key = document.createElement('span');
    key.className = 'k';
    key.textContent = `${k}: `;
    const val = document.createElement('b');
    val.textContent = v;
    d.append(key, val);
    return d;
  };
  box.append(line('Bruecke', `${STATUS_TEXT[s.status]}${s.bridge ? ` · ${s.bridge}` : ''}`));
  box.append(line('Ziel', `${s.target.host}:${s.target.port}`));
  box.append(line('Laufzeit', s.latency == null ? '–' : `${s.latency} ms`));
  box.append(line('Pakete', `${s.sent} gesendet · ${s.recv} empfangen`));
  if (s.error) box.append(line('Hinweis', s.error));
}

function applyConnSettings(reconnect = false) {
  link.configure({
    url: settings.url,
    target: settings.target,
    listenPort: settings.listenPort,
    nova: settings.nova,
  });
  if (reconnect) link.connect();
}

/* ------------------------------------------------------------- Zeichnen -- */

function renderTabs() {
  pageTabs.replaceChildren();
  project.pages.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'pagetab' + (p.id === project.currentPageId ? ' on' : '');
    b.textContent = p.name;
    b.type = 'button';
    b.addEventListener('click', () => {
      project.currentPageId = p.id;
      clearUndo();
      persist();
      renderTabs();
      renderSurface();
      setSelection(null);
    });
    pageTabs.append(b);
  });
}

/**
 * Zeilenhoehe. „Einpassen" gilt nur in der Live-Ansicht: beim Bearbeiten
 * wuerde jede Groessenaenderung alle Zeilen mitschrumpfen — die Kachel saehe
 * dann aus, als liesse sie sich nicht aufziehen.
 */
function fitRows() {
  const page = currentPage();
  const rows = usedRows(page.widgets);
  const useFit = !!page.fit && rows > 0 && mode === 'live';
  surface.classList.toggle('fit', useFit);
  if (!useFit) {
    surface.style.removeProperty('--rowh');
    return;
  }
  const cs = getComputedStyle(surface);
  const gap = parseFloat(cs.gap) || 8;
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const h = surface.clientHeight - padY - gap * (rows - 1);
  surface.style.setProperty('--rowh', `${Math.max(26, h / rows)}px`);
}

function renderSurface() {
  const page = currentPage();
  instances = new Map();
  byAddress = new Map();
  surface.replaceChildren();
  surface.style.setProperty('--cols', page.columns);
  surface.classList.toggle('editing', mode === 'edit');
  surface.classList.toggle('locked', mode === 'live' && settings.locked);

  const ctx = {
    live: mode === 'live' && !settings.locked,
    send: (address, args, now) => (now ? link.sendNow(address, args) : link.send(address, args)),
    commit: persist,
  };

  for (const w of page.widgets) {
    const inst = createWidget(w, ctx);
    inst.el.style.gridColumn = `${w.gx + 1} / span ${w.cw}`;
    inst.el.style.gridRow = `${w.gy + 1} / span ${w.ch}`;
    if (mode === 'edit') {
      if (w.id === selectedId) inst.el.classList.add('sel');
      const handle = document.createElement('div');
      handle.className = 'handle';
      handle.setAttribute('aria-hidden', 'true');
      inst.el.append(handle);
    }
    surface.append(inst.el);
    instances.set(w.id, inst);
    for (const addr of [w.address, w.addressY, ...w.items.map((i) => i.address)]) {
      if (!addr) continue;
      if (!byAddress.has(addr)) byAddress.set(addr, []);
      byAddress.get(addr).push(inst);
    }
  }

  $('#emptyHint').hidden = page.widgets.length > 0 || mode === 'edit';
  fitRows();
}

/* ------------------------------------------- Rueckgaengig / Wiederherstellen */

/**
 * Zurueck und wieder vor gelten dem AUFBAU im Bearbeiten-Modus: verschieben,
 * Groesse, anlegen, loeschen, duplizieren, aufraeumen, Spalten, Einstellungen.
 *
 * Gemerkt wird jeweils die ganze Seite als Text — bei den paar Dutzend
 * Bauteilen einer Seite ist das billiger als Buch ueber einzelne Aenderungen
 * zu fuehren, und es kann nichts auseinanderlaufen. Beide Richtungen nutzen
 * denselben Weg: der Schritt wandert von einem Stapel auf den anderen, und
 * was gerade dasteht, geht als Gegenstueck mit.
 *
 * Die Stapel gelten nur fuer die laufende Sitzung im Bearbeiten-Modus: beim
 * Verlassen, beim Seitenwechsel und bei einem neuen Projekt werden sie
 * geleert. Sonst koennte ein Schritt zurueck einen Stand wiederherstellen,
 * der mit dem, was inzwischen live passiert ist, nichts mehr zu tun hat.
 */
const UNDO_MAX = 30;
let undoStack = [];
let redoStack = [];

/** Live-Werte: die gehoeren dem Pult, nicht dem Aufbau — sie bleiben stehen. */
const LIVE_KEYS = ['value', 'x', 'y', 'r', 'g', 'b', 'a', 'text'];

const snapshotPage = () => JSON.stringify(currentPage());

/**
 * Einen Schritt merken. `snap` erlaubt einen frueher genommenen Stand.
 * Jede neue Aenderung beendet den Faden nach vorn — wie ueberall sonst auch.
 */
function pushUndo(label, snap = snapshotPage()) {
  undoStack.push({ pageId: currentPage().id, label, snap });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack = [];
  paintHistory();
}

function clearUndo() {
  undoStack = [];
  redoStack = [];
  paintHistory();
}

function paintHistory() {
  const set = (sel, stack, word) => {
    const b = $(sel);
    if (!b) return;
    const top = stack[stack.length - 1];
    b.disabled = !top;
    const text = top ? `${word}: ${top.label}` : word;
    b.setAttribute('aria-label', text);
    b.title = text;
  };
  set('#btnUndo', undoStack, 'Rueckgaengig');
  set('#btnRedo', redoStack, 'Wiederherstellen');
}

/**
 * Einen Schritt von `from` nach `to` gehen: den gemerkten Stand herstellen
 * und den jetzigen als Gegenstueck ablegen.
 */
function stepHistory(from, to) {
  const step = from.pop();
  if (!step) { paintHistory(); return; }
  const i = project.pages.findIndex((p) => p.id === step.pageId);
  if (i < 0) { paintHistory(); return; }

  const current = project.pages[i];
  to.push({ pageId: step.pageId, label: step.label, snap: JSON.stringify(current) });
  if (to.length > UNDO_MAX) to.shift();

  const live = new Map(current.widgets.map((w) => [w.id, w]));
  const page = normalizePage(JSON.parse(step.snap));
  for (const w of page.widgets) {
    const now = live.get(w.id);
    if (!now) continue;   // war geloescht: der gemerkte Stand gilt
    for (const k of LIVE_KEYS) w[k] = now[k];
  }
  project.pages[i] = page;
  project.currentPageId = page.id;

  persist();
  paintHistory();
  renderTabs();
  $('#colOut').textContent = page.columns;   // „Spalten" kann mitgehen
  renderSurface();
  setSelection(page.widgets.some((w) => w.id === selectedId) ? selectedId : null);
  try { navigator.vibrate?.(12); } catch { /* egal */ }
}

const undo = () => stepHistory(undoStack, redoStack);
const redo = () => stepHistory(redoStack, undoStack);

/* -------------------------------------------------------------- Auswahl --- */

/** Das ausgewaehlte Bauteil der aktuellen Seite (oder null). */
const selected = () => currentPage().widgets.find((x) => x.id === selectedId) || null;

/**
 * Auswahl setzen und die Leiste darunter auffrischen. Dort liegen
 * Einstellungen, Duplizieren und Loeschen — ohne Umweg ueber ein Blatt.
 */
function setSelection(id) {
  selectedId = id;
  for (const t of $$('.tile', surface)) t.classList.toggle('sel', t.dataset.id === id);
  const w = selected();
  const row = $('#selRow');
  if (!row) return;
  row.hidden = !w || mode !== 'edit';
  // Solange etwas gewaehlt ist, tritt der Merksatz zurueck — die Leiste
  // erklaert sich selbst und die Bedienflaeche bleibt gross.
  $('#editbar').classList.toggle('has-sel', !row.hidden);
  if (w) $('#selName').textContent = `${w.label || TYPES[w.type].name} · ${TYPES[w.type].name}`;
}

function duplicateSelected(w) {
  const page = currentPage();
  pushUndo('Duplizieren');
  const copy = duplicateWidget(w, page.widgets);
  page.widgets.push(copy);
  placeCopy(page.widgets, page.columns, copy, w);
  persist();
  renderSurface();
  setSelection(copy.id);
  return copy;
}

function deleteWidget(w) {
  const page = currentPage();
  pushUndo('Loeschen');
  page.widgets = page.widgets.filter((x) => x.id !== w.id);
  persist();
  renderSurface();
  setSelection(null);
}

/* --------------------------------------------------------------- Modus --- */

function setMode(next) {
  mode = next;
  const on = next === 'edit';
  $('#btnMode').setAttribute('aria-pressed', String(on));
  $('#editbar').hidden = !on;
  $('#colOut').textContent = currentPage().columns;
  renderSurface();
  setSelection(on ? selectedId : null);
  if (!on) { clearUndo(); closeSheet(); }
  else paintHistory();
}

/** Bauteil anlegen — an der gemerkten Stelle, sonst am ersten freien Platz. */
function addWidget(type) {
  const page = currentPage();
  pushUndo('Einfuegen');
  const w = makeWidget(type);
  w.cw = Math.min(w.cw, page.columns);
  page.widgets.push(w);
  if (pendingSlot) {
    dropAt(page.widgets, page.columns, w, { ...pendingSlot, cw: w.cw, ch: w.ch });
  } else {
    const slot = findSlot(page.widgets.filter((x) => x.id !== w.id), page.columns, w.cw, w.ch);
    w.gx = slot.gx;
    w.gy = slot.gy;
  }
  pendingSlot = null;
  persist();
  renderSurface();
  setSelection(w.id);
  openInspector(w);
}

/* ------------------------------------------------------------- Blaetter -- */

const SHEETS = ['#sheetMenu', '#sheetPages', '#sheetConn', '#sheetMonitor', '#sheetProject',
  '#sheetSettings', '#sheetReset', '#sheetHelp', '#sheetPick', '#sheetInsp'];
let sheetStack = [];

/**
 * Nach einem Tipp mit dem Finger schickt der Browser noch einen `click`
 * hinterher — der landet auf dem Blatt, das der Tipp gerade geoeffnet hat,
 * und schloss es sofort wieder (auf dem Scrim) oder loeste dort etwas aus.
 * Deshalb ist ein frisch geoeffnetes Blatt einen Wimpernschlag lang
 * unempfindlich; danach nimmt das `fresh` weg.
 */
const GHOST_MS = 320;
let ghostTimer = 0;

function showSheet(sel) {
  for (const s of SHEETS) $(s).hidden = s !== sel;
  $('#scrim').hidden = !sel;
  clearTimeout(ghostTimer);
  const fresh = [$('#scrim'), ...(sel ? [$(sel)] : [])];
  for (const n of [$('#scrim'), ...SHEETS.map((x) => $(x))]) n.classList.remove('fresh');
  if (!sel) return;
  for (const n of fresh) n.classList.add('fresh');
  ghostTimer = setTimeout(() => { for (const n of fresh) n.classList.remove('fresh'); }, GHOST_MS);
}

/** Blatt oeffnen; `stack` = aus einem anderen Blatt heraus (Pfeil zurueck). */
function openSheet(sel, stack = false) {
  if (stack) sheetStack.push(SHEETS.find((s) => !$(s).hidden) || null);
  else sheetStack = [];
  prepareSheet(sel);
  showSheet(sel);
}

function backSheet() {
  const prev = sheetStack.pop();
  if (!prev) { closeSheet(); return; }
  prepareSheet(prev);
  showSheet(prev);
}

function closeSheet() {
  sheetStack = [];
  showSheet(null);
}

/** Inhalte auffrischen, bevor ein Blatt sichtbar wird. */
function prepareSheet(sel) {
  if (sel === '#sheetMenu') {
    const page = currentPage();
    $('#miPages').textContent = `${project.pages.length} ${project.pages.length === 1 ? 'Seite' : 'Seiten'} · aktuell „${page.name}"`;
    $('#miProject').textContent = project.name;
    paintConnection(link.state);
  }
  if (sel === '#sheetPages') { renderPageList(); $('#fitChk').checked = !!currentPage().fit; }
  if (sel === '#sheetConn') fillConnForm();
  if (sel === '#sheetMonitor') renderLog();
  if (sel === '#sheetProject') { $('#inProject').value = project.name; renderLibrary(); }
  if (sel === '#sheetReset') $('#resetPageInfo').textContent = `Ersetzt die Seite „${currentPage().name}" durch die gewaehlte Vorlage. Andere Seiten bleiben unberuehrt.`;
  if (sel === '#sheetPick') renderPicker();
}

/** Groesse und Ausrichtung sitzen in der Kopfzeile des Blattes. */
function paintInspHead(w, page, onChange) {
  const box = $('#inspHead');
  box.replaceChildren();
  const m = minSize(w.type);
  const step = (label, get, set, lo, hi) => {
    const wrap = document.createElement('span');
    wrap.className = 'stepper tight';
    const mk = (txt, delta, aria) => {
      const b = document.createElement('button');
      b.className = 'btn step';
      b.type = 'button';
      b.textContent = txt;
      b.setAttribute('aria-label', `${label} ${aria}`);
      b.addEventListener('click', () => { set(clamp(get() + delta, lo, hi)); onChange(); paintInspHead(w, page, onChange); });
      return b;
    };
    const out = document.createElement('span');
    out.className = 'stepval';
    out.innerHTML = `<i>${label}</i>`;
    const b = document.createElement('b');
    b.textContent = String(get());
    out.append(b);
    wrap.append(mk('−', -1, 'kleiner'), out, mk('+', 1, 'groesser'));
    return wrap;
  };
  box.append(
    step('B', () => w.cw, (v) => { w.cw = v; }, m.cw, page.columns),
    step('H', () => w.ch, (v) => { w.ch = v; }, m.ch, MAX_ROWS),
  );
  if (w.type === 'fader' || w.type === 'color') {
    const b = document.createElement('button');
    b.className = 'btn sq';
    b.type = 'button';
    b.textContent = w.orient === 'h' ? '↔' : '↕';
    b.title = w.orient === 'h' ? 'waagerecht' : 'senkrecht';
    b.setAttribute('aria-label', `Ausrichtung: ${b.title}`);
    b.addEventListener('click', () => {
      w.orient = w.orient === 'h' ? 'v' : 'h';
      onChange();
      paintInspHead(w, page, onChange);
    });
    box.append(b);
  }
}

function openInspector(w) {
  const page = currentPage();
  const title = () => { $('#inspTitle').textContent = w.label || TYPES[w.type].name; };
  title();
  // Ein Schritt je geoeffnetem Blatt: waehrend des Tippens einer Adresse
  // waere jeder Buchstabe sonst ein eigener Schritt zurueck.
  const before = snapshotPage();
  let noted = false;
  const headChange = () => {
    if (!noted) { pushUndo('Einstellungen', before); noted = true; }
    persist(); renderSurface(); setSelection(w.id);
  };
  paintInspHead(w, page, headChange);
  buildInspector($('#inspBody'), w, page, {
    onChange: () => {
      if (!noted) { pushUndo('Einstellungen', before); noted = true; }
      persist(); renderSurface(); setSelection(w.id); title();
    },
    onHead: () => paintInspHead(w, page, headChange),
    onDelete: () => { deleteWidget(w); closeSheet(); },
    onDuplicate: () => openInspector(duplicateSelected(w)),
  });
  openSheet('#sheetInsp');
}

/* ------------------------------------------------------ Bauteil-Auswahl -- */

function renderPicker() {
  const list = $('#pickList');
  list.replaceChildren();
  for (const type of TYPE_ORDER) {
    const b = document.createElement('button');
    b.className = 'pico';
    b.type = 'button';
    b.title = TYPES[type].hint;
    const t = document.createElement('span');
    t.className = 'pico-t';
    t.textContent = TYPES[type].name;
    b.append(typeIcon(type), t);
    b.addEventListener('click', () => { closeSheet(); addWidget(type); });
    list.append(b);
  }
}

/* -------------------------------------------------------------- Monitor -- */

function renderLog() {
  logDirty = false;
  const node = $('#log');
  if (!node || $('#sheetMonitor').hidden) return;
  const showOut = $('#chkOut').checked;
  const showIn = $('#chkIn').checked;
  const rows = logBuf.filter((e) => (e.dir === 'out' ? showOut : e.dir === 'in' ? showIn : true)).slice(-120);
  node.replaceChildren();
  for (const e of rows) {
    const d = document.createElement('div');
    d.className = e.dir;
    const t = new Date(e.at);
    const time = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    d.textContent = `${time}  ${e.dir === 'in' ? '←' : e.dir === 'out' ? '→' : '!'}  ${formatMessage(e.address, e.args)}${e.note ? `  (${e.note})` : ''}`;
    if (e.dir === 'in') {
      d.title = 'Bauteil aus dieser Adresse anlegen';
      d.addEventListener('click', () => widgetFromFeedback(e));
    }
    node.append(d);
  }
  node.scrollTop = node.scrollHeight;
}

/** Aus einer empfangenen Nachricht direkt ein passendes Bauteil bauen. */
function widgetFromFeedback(entry) {
  const page = currentPage();
  const first = entry.args[0];
  const type = typeof first === 'string' ? 'meter' : 'fader';
  const w = makeWidget(type, {
    address: entry.address,
    label: entry.address.split('/').filter(Boolean).slice(-2).join(' ') || entry.address,
  });
  if (type === 'meter') w.source = 'text';
  if (typeof first === 'number' && (first > 1 || first < 0)) { w.min = 0; w.max = Math.max(1, Math.ceil(first)); }
  w.cw = Math.min(w.cw, page.columns);
  const slot = findSlot(page.widgets, page.columns, w.cw, w.ch);
  w.gx = slot.gx;
  w.gy = slot.gy;
  setMode('edit');          // leert den Stapel — deshalb erst danach merken
  pushUndo('Einfuegen');
  page.widgets.push(w);
  persist();
  renderSurface();
  setSelection(w.id);
  openInspector(w);
}

/* ---------------------------------------------------------- Seitenliste -- */

function renderPageList() {
  const list = $('#pageList');
  list.replaceChildren();
  project.pages.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'item' + (p.id === project.currentPageId ? ' cur' : '');
    const name = document.createElement('input');
    name.value = p.name;
    name.className = 'grow';
    name.addEventListener('input', () => { p.name = name.value; persist(); renderTabs(); });
    name.addEventListener('focus', () => {
      if (p.id === project.currentPageId) return;
      project.currentPageId = p.id;
      clearUndo();
      persist(); renderTabs(); renderSurface(); renderPageList(); setSelection(null);
    });
    row.append(name);

    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'iconbtn';
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    row.append(mk('↑', 'nach oben', () => {
      if (i === 0) return;
      project.pages.splice(i - 1, 0, project.pages.splice(i, 1)[0]);
      persist(); renderPageList(); renderTabs();
    }));
    row.append(mk('↓', 'nach unten', () => {
      if (i === project.pages.length - 1) return;
      project.pages.splice(i + 1, 0, project.pages.splice(i, 1)[0]);
      persist(); renderPageList(); renderTabs();
    }));
    row.append(mk('✕', 'loeschen', () => {
      if (project.pages.length < 2) return;
      if (!confirm(`Seite „${p.name}" loeschen?`)) return;
      project.pages = project.pages.filter((x) => x.id !== p.id);
      if (project.currentPageId === p.id) project.currentPageId = project.pages[0].id;
      clearUndo();
      persist(); renderPageList(); renderTabs(); renderSurface(); setSelection(null);
    }));
    list.append(row);
  });
}

function renderLibrary() {
  const list = $('#libList');
  list.replaceChildren();
  const lib = loadLibrary();
  if (!lib.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Noch nichts gesichert.';
    list.append(p);
    return;
  }
  for (const p of lib) {
    const row = document.createElement('div');
    row.className = 'item';
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = `${p.name} · ${new Date(p.savedAt || Date.now()).toLocaleDateString('de-DE')}`;
    row.append(label);
    const open = document.createElement('button');
    open.className = 'btn';
    open.type = 'button';
    open.textContent = 'Laden';
    open.addEventListener('click', () => {
      project = normalizeProject(p);
      clearUndo();
      persist(); renderTabs(); renderSurface(); setSelection(null); renderLibrary();
      $('#inProject').value = project.name;
    });
    const del = document.createElement('button');
    del.className = 'iconbtn';
    del.type = 'button';
    del.textContent = '✕';
    del.addEventListener('click', () => { removeFromLibrary(p.id); renderLibrary(); });
    row.append(open, del);
    list.append(row);
  }
}

/* -------------------------------------------------------------- Aussehen -- */

/**
 * Dunkel (Vorgabe), hell, oder wie das System es haelt. Die Klasse `hell`
 * schaltet im Stylesheet den ganzen Farbsatz um; gesetzt wird sie hier, damit
 * die Systemeinstellung nur zaehlt, wenn man sie auch ausgewaehlt hat.
 */
const hellMedia = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme() {
  const hell = settings.theme === 'light' || (settings.theme === 'auto' && hellMedia.matches);
  document.documentElement.classList.toggle('hell', hell);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = hell ? '#ffffff' : '#0b0e13';
}

/* ------------------------------------------------------------ Bildschirm -- */

/**
 * Vollbild blendet die Leisten des Browsers aus — auf dem Handy sind das
 * schnell zwei Zentimeter Pult. Der Haken zeigt den JETZIGEN Zustand, nicht
 * einen gespeicherten Wunsch: Vollbild laesst sich nur auf Tastendruck
 * einschalten, beim naechsten Start also nie von selbst.
 */
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

const fsMoeglich = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled
  || document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

async function setFullscreen(on) {
  const el = document.documentElement;
  try {
    if (on) await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    else await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.());
  } catch { /* der Browser darf ablehnen — dann bleibt der Haken, wie er war */ }
  paintFullscreen();
}

function paintFullscreen() {
  const chk = $('#chkFull');
  if (chk) chk.checked = !!fsElement();
}

async function requestWakeLock() {
  if (!settings.wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* z. B. im Hintergrund — egal */ }
}

/* ------------------------------------------------------------- Bindings -- */

function setColumns(cols) {
  const page = currentPage();
  const next = clamp(cols, MIN_COLS, MAX_COLS);
  if (next === page.columns) return;
  pushUndo('Spalten');
  recolumn(page, next);
  $('#colOut').textContent = next;
  persist();
  renderSurface();
  setSelection(selectedId);
}

function bind() {
  $('#btnMenu').addEventListener('click', () => openSheet('#sheetMenu'));
  $('#btnConn').addEventListener('click', () => openSheet('#sheetConn'));
  $('#btnMode').addEventListener('click', () => setMode(mode === 'edit' ? 'live' : 'edit'));
  $('#scrim').addEventListener('click', closeSheet);
  for (const b of $$('[data-close]')) b.addEventListener('click', closeSheet);
  for (const b of $$('[data-back]')) b.addEventListener('click', backSheet);
  for (const b of $$('[data-go]')) b.addEventListener('click', () => openSheet(b.dataset.go, true));

  /* Bearbeiten-Leiste */
  $('#btnAdd').addEventListener('click', () => { pendingSlot = null; openSheet('#sheetPick'); });
  $('#colMinus').addEventListener('click', () => setColumns(currentPage().columns - 1));
  $('#colPlus').addEventListener('click', () => setColumns(currentPage().columns + 1));
  $('#btnArrange').addEventListener('click', () => {
    const page = currentPage();
    pushUndo('Aufraeumen');
    autoArrange(page.widgets, page.columns);
    persist();
    renderSurface();
    setSelection(selectedId);
  });

  /* Auswahl-Leiste: gilt fuer das gerade gewaehlte Bauteil */
  $('#btnUndo').append(uiIcon('undo'));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').append(uiIcon('redo'));
  $('#btnRedo').addEventListener('click', redo);
  // Am Rechner die gewohnten Kuerzel — am Handy reichen die Schaltflaechen.
  // Im Eingabefeld hat das Zurueck des Browsers Vorrang.
  window.addEventListener('keydown', (ev) => {
    if (mode !== 'edit' || !(ev.ctrlKey || ev.metaKey)) return;
    const t = ev.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const key = ev.key.toLowerCase();
    if (key === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
  });

  $('#btnSelDup').append(uiIcon('copy'));
  $('#btnSelDel').append(uiIcon('trash'));
  $('#btnSelEdit').addEventListener('click', () => { const w = selected(); if (w) openInspector(w); });
  $('#btnSelDup').addEventListener('click', () => { const w = selected(); if (w) duplicateSelected(w); });
  $('#btnSelDel').addEventListener('click', () => { const w = selected(); if (w) deleteWidget(w); });

  attachEditing(surface, {
    getPage: currentPage,
    isEditing: () => mode === 'edit',
    selectedId: () => selectedId,
    onSnapshot: (label) => pushUndo(label),
    onChange: () => { persist(); renderSurface(); setSelection(selectedId); },
    onSelect: (id) => setSelection(id),
    onOpen: (w) => openInspector(w),
    onEmptyHold: (cell) => {
      // Langer Druck auf freie Flaeche: hier soll das naechste Bauteil hin.
      pendingSlot = cell;
      try { navigator.vibrate?.(12); } catch { /* egal */ }
      openSheet('#sheetPick');
    },
  });

  /* Verbindung */
  const readConn = () => ({
    url: $('#inUrl').value.trim(),
    target: { host: $('#inHost').value.trim() || '127.0.0.1', port: Number($('#inPort').value) || 8000 },
    listenPort: Number($('#inListen').value) || 0,
    nova: { host: $('#inNovaHost').value.trim(), port: Number($('#inNovaPort').value) || 5200 },
  });
  const saveConn = () => {
    Object.assign(settings, readConn());
    saveSettings(settings);
    applyConnSettings(false);
  };
  for (const id of ['#inUrl', '#inHost', '#inPort', '#inListen', '#inNovaHost', '#inNovaPort']) {
    $(id).addEventListener('change', saveConn);
  }
  $('#btnConnect').addEventListener('click', () => { saveConn(); applyConnSettings(true); });
  $('#btnDisconnect').addEventListener('click', () => link.disconnect());

  /* Seiten & Vorlagen */
  for (const sel of [$('#selPreset'), $('#selResetPreset')]) {
    for (const p of PRESETS) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.name} — ${p.hint}`;
      sel.append(o);
    }
  }
  $('#btnAddPage').addEventListener('click', () => {
    const page = makePage(`Seite ${project.pages.length + 1}`, { fit: false });
    project.pages.push(page);
    project.currentPageId = page.id;
    selectedId = null;
    clearUndo();
    persist(); renderPageList(); renderTabs(); closeSheet(); setMode('edit');
  });
  $('#btnAddPreset').addEventListener('click', () => {
    const page = buildPreset($('#selPreset').value);
    project.pages.push(page);
    project.currentPageId = page.id;
    clearUndo();
    persist(); renderPageList(); renderTabs(); renderSurface(); setSelection(null);
  });
  $('#fitChk').addEventListener('change', (ev) => {
    currentPage().fit = ev.target.checked;
    persist();
    fitRows();
  });

  /* Projekt */
  $('#inProject').addEventListener('input', (ev) => { project.name = ev.target.value; persist(); });
  $('#btnSaveLib').addEventListener('click', () => { storeInLibrary(project); renderLibrary(); });
  $('#btnExport').addEventListener('click', exportProject);
  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', importProject);

  /* Zuruecksetzen */
  $('#btnResetPage').addEventListener('click', () => {
    const page = currentPage();
    if (!confirm(`Seite „${page.name}" durch die Vorlage ersetzen?`)) return;
    const fresh = buildPreset($('#selResetPreset').value);
    const i = project.pages.indexOf(page);
    fresh.id = page.id;
    project.pages[i] = fresh;
    clearUndo();
    persist(); renderTabs(); renderSurface(); setSelection(null);
    closeSheet();
  });
  $('#btnResetAll').addEventListener('click', () => {
    if (!confirm('Alle Seiten auf die Werkseinstellung zuruecksetzen? Der aktuelle Aufbau geht verloren.')) return;
    project = starterProject();
    clearUndo();
    persist(); renderTabs(); renderSurface(); setSelection(null);
    closeSheet();
  });

  /* Einstellungen */
  const chk = (id, key, after) => {
    const node = $(id);
    node.checked = !!settings[key];
    node.addEventListener('change', () => {
      settings[key] = node.checked;
      saveSettings(settings);
      after?.();
    });
  };
  const theme = $('#selTheme');
  theme.value = settings.theme;
  theme.addEventListener('change', () => {
    settings.theme = theme.value;
    saveSettings(settings);
    applyTheme();
  });
  hellMedia.addEventListener('change', applyTheme);

  /* Vollbild und Bildschirm: beides kann der Browser verweigern — dann steht
     statt eines wirkungslosen Hakens ein Hinweis da. */
  if (fsMoeglich()) {
    $('#chkFull').addEventListener('change', (ev) => setFullscreen(ev.target.checked));
    for (const name of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(name, paintFullscreen);
    }
    paintFullscreen();
  } else {
    $('#rowFull').hidden = true;
    $('#noteFull').hidden = false;
  }
  $('#noteWake').hidden = 'wakeLock' in navigator;

  chk('#chkAuto', 'autoConnect');
  chk('#chkWake', 'wakeLock', () => { if (settings.wakeLock) requestWakeLock(); else { wakeLock?.release?.(); wakeLock = null; } });
  chk('#chkHaptic', 'haptics', () => setHaptics(settings.haptics));
  chk('#chkLock', 'locked', renderSurface);

  /* Monitor */
  $('#chkOut').addEventListener('change', renderLog);
  $('#chkIn').addEventListener('change', renderLog);
  $('#btnClearLog').addEventListener('click', () => { logBuf.length = 0; renderLog(); });

  $('#verLine').textContent = `OSC Pad ${APP_VERSION} · laeuft vollstaendig im Geraet`;

  window.addEventListener('resize', fitRows);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });
}

function fillConnForm() {
  $('#inUrl').value = settings.url || defaultBridgeUrl();
  $('#inHost').value = settings.target.host;
  $('#inPort').value = settings.target.port;
  $('#inListen').value = settings.listenPort;
  $('#inNovaHost').value = settings.nova.host;
  $('#inNovaPort').value = settings.nova.port;
  paintConnection(link.state);
}

function exportProject() {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${project.name.replace(/[^\w -]+/g, '_') || 'osc-pad'}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importProject(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      project = normalizeProject(JSON.parse(String(reader.result)));
      clearUndo();
      persist();
      renderTabs(); renderSurface(); setSelection(null); renderLibrary();
      $('#inProject').value = project.name;
    } catch {
      alert('Datei konnte nicht gelesen werden.');
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

/* ----------------------------------------------------------------- Start -- */

setHaptics(settings.haptics);
applyTheme();
bind();
renderTabs();
setMode('live');
applyConnSettings(false);
if (settings.autoConnect) link.connect();
requestWakeLock();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* z. B. ueber http geladen */ });
  });
}
