/**
 * OSC Pad — Zusammenbau: Ansicht, Seiten, Verbindung, Monitor, Speichern.
 *
 * Die Blaetter (Sheets) bilden einen kleinen Stapel: aus dem Menue geht es in
 * ein Unterblatt, der Pfeil links fuehrt zurueck. Dadurch bleibt jedes Blatt
 * kurz und man findet sich auch mit einer Hand zurecht.
 */

import {
  makeWidget, makePage, normalizeProject, autoArrange, placeMissing, dropAt,
  usedRows, rescale, findSlot, clamp, TYPES, TYPE_ORDER, MIN_COLS, MAX_COLS,
} from './model.js';
import { PRESETS, buildPreset, starterProject } from './presets.js';
import { createWidget, setHaptics } from './widgets.js';
import { attachEditing, buildInspector, duplicateWidget } from './editor.js';
import { createLink, defaultBridgeUrl } from './conn.js';
import { formatMessage } from './osc.js';
import {
  loadProject, saveProject, loadSettings, saveSettings,
  loadLibrary, storeInLibrary, removeFromLibrary,
} from './store.js';

export const APP_VERSION = '1.1.0';

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
    for (const inst of list) inst.feedback(m.args, m.types);
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
      selectedId = null;
      persist();
      renderTabs();
      renderSurface();
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

/* --------------------------------------------------------------- Modus --- */

function setMode(next) {
  mode = next;
  const on = next === 'edit';
  $('#btnMode').setAttribute('aria-pressed', String(on));
  $('#editbar').hidden = !on;
  $('#colOut').textContent = currentPage().columns;
  renderSurface();
  if (!on) closeSheet();
}

/** Bauteil anlegen — an der angetippten Stelle, sonst am ersten freien Platz. */
function addWidget(type) {
  const page = currentPage();
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
  selectedId = w.id;
  persist();
  renderSurface();
  openInspector(w);
}

/* ------------------------------------------------------------- Blaetter -- */

const SHEETS = ['#sheetMenu', '#sheetPages', '#sheetConn', '#sheetMonitor', '#sheetProject',
  '#sheetSettings', '#sheetReset', '#sheetHelp', '#sheetPick', '#sheetInsp'];
let sheetStack = [];

function showSheet(sel) {
  for (const s of SHEETS) $(s).hidden = s !== sel;
  $('#scrim').hidden = !sel;
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

function openInspector(w) {
  const page = currentPage();
  $('#inspTitle').textContent = w.label || TYPES[w.type].name;
  buildInspector($('#inspBody'), w, page, {
    onChange: () => { persist(); renderSurface(); $('#inspTitle').textContent = w.label || TYPES[w.type].name; },
    onDelete: () => {
      page.widgets = page.widgets.filter((x) => x.id !== w.id);
      selectedId = null;
      persist();
      renderSurface();
      closeSheet();
    },
    onDuplicate: () => {
      const copy = duplicateWidget(w);
      page.widgets.push(copy);
      placeMissing(page.widgets, page.columns);
      selectedId = copy.id;
      persist();
      renderSurface();
      openInspector(copy);
    },
  });
  openSheet('#sheetInsp');
}

/* ------------------------------------------------------ Bauteil-Auswahl -- */

function renderPicker() {
  const list = $('#pickList');
  list.replaceChildren();
  for (const type of TYPE_ORDER) {
    const b = document.createElement('button');
    b.className = 'menuitem';
    b.type = 'button';
    const t = document.createElement('span');
    t.className = 'mi-t';
    t.textContent = TYPES[type].name;
    const s = document.createElement('span');
    s.className = 'mi-s';
    s.textContent = TYPES[type].hint;
    b.append(t, s);
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
  page.widgets.push(w);
  selectedId = w.id;
  persist();
  setMode('edit');
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
      persist(); renderTabs(); renderSurface(); renderPageList();
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
      persist(); renderPageList(); renderTabs(); renderSurface();
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
      persist(); renderTabs(); renderSurface(); renderLibrary();
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

/* ------------------------------------------------------------ Bildschirm -- */

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
  rescale(page, next);
  $('#colOut').textContent = next;
  persist();
  renderSurface();
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
    autoArrange(page.widgets, page.columns);
    persist();
    renderSurface();
  });

  attachEditing(surface, {
    getPage: currentPage,
    isEditing: () => mode === 'edit',
    onChange: () => { persist(); renderSurface(); },
    onSelect: (id) => { selectedId = id; for (const t of $$('.tile', surface)) t.classList.toggle('sel', t.dataset.id === id); },
    onTap: (w) => openInspector(w),
    onEmptyTap: (cell) => { pendingSlot = cell; openSheet('#sheetPick'); },
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
    persist(); renderPageList(); renderTabs(); closeSheet(); setMode('edit');
  });
  $('#btnAddPreset').addEventListener('click', () => {
    const page = buildPreset($('#selPreset').value);
    project.pages.push(page);
    project.currentPageId = page.id;
    persist(); renderPageList(); renderTabs(); renderSurface();
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
    selectedId = null;
    persist(); renderTabs(); renderSurface();
    closeSheet();
  });
  $('#btnResetAll').addEventListener('click', () => {
    if (!confirm('Alle Seiten auf die Werkseinstellung zuruecksetzen? Der aktuelle Aufbau geht verloren.')) return;
    project = starterProject();
    selectedId = null;
    persist(); renderTabs(); renderSurface();
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
      persist();
      renderTabs(); renderSurface(); renderLibrary();
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
