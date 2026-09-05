/** Anwendungslogik: Bindings, Ansichten, Export, Persistenz. */

import { MODULES, PROCESSORS, START_CORNERS, REFRESH_RATES, pxPortAt } from './data.js';
import { computeAll } from './calc.js';
import { renderWall, renderLegend, renderFit } from './render.js';
import { buildPdf } from './pdf.js';
import {
  defaultState, loadCurrent, saveCurrent, listProjects, storeProject, deleteProject,
  migrate, clampNum, parseDecimal, loadSections, saveSections,
} from './state.js';

export const APP_VERSION = '1.1.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const nf = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = loadCurrent();
let calc = computeAll(state);
let sections = loadSections();

/* ------------------------------------------------------------------ Pfade */

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

/* ------------------------------------------------------- Auswahllisten füllen */

function fillSelects() {
  $('#moduleSelect').innerHTML = MODULES.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
  $('#procSelect').innerHTML = PROCESSORS.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  $('#hzSelect').innerHTML = REFRESH_RATES.map((hz) => `<option value="${hz}">${hz} Hz</option>`).join('');
  const corners = START_CORNERS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $$('select[data-corners]').forEach((el) => { el.innerHTML = corners; });
}

/* ------------------------------------------------------------- Eingabe-Bindung */

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    const min = el.min === '' ? -Infinity : Number(el.min);
    const max = el.max === '' ? Infinity : Number(el.max);
    const fallback = Number(getPath(state, el.dataset.bind));
    return clampNum(el.value, min, max, Number.isFinite(fallback) ? fallback : min);
  }
  if (el.dataset.number !== undefined) return Number(el.value);
  return el.value;
}

function bindInputs() {
  $$('[data-bind]').forEach((el) => {
    const path = el.dataset.bind;
    const commit = () => {
      setPath(state, path, readInput(el));
      if (path.startsWith('module.')) onModuleEdited();
      if (path === 'signal.ports' || path === 'signal.pxPort60' || path === 'signal.pxTotal') {
        state.signal.processorId = 'custom-p';
      }
      if (path === 'grid.cols' || path === 'grid.rows') syncTargetFromGrid();
      update();
    };
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', commit);
    if (el.type === 'number') el.addEventListener('blur', () => { el.value = getPath(state, path); });
  });
}

/** Eigene Modulwerte: Preset auf „Eigenes Modul“ stellen und Raster nachziehen. */
function onModuleEdited() {
  if (state.moduleId !== 'custom') {
    state.moduleId = 'custom';
    state.module.label = 'Eigenes Modul';
    state.module.note = 'Frei konfigurierbar';
  }
  gridFromTarget();
}

/** Modulzahl aus dem Zielmaß runden. */
function gridFromTarget() {
  const cols = clampNum(Math.round((state.size.w * 1000) / state.module.w), 1, 100, 1);
  const rows = clampNum(Math.round((state.size.h * 1000) / state.module.h), 1, 100, 1);
  state.grid.cols = Math.round(cols);
  state.grid.rows = Math.round(rows);
}

/** Nach einer Feinjustierung per ± wird das Zielmaß zum Ist-Maß. */
function syncTargetFromGrid() {
  state.size.w = (state.grid.cols * state.module.w) / 1000;
  state.size.h = (state.grid.rows * state.module.h) / 1000;
}

function bindSizeFields() {
  const bind = (id, axis) => {
    const el = $(id);
    el.addEventListener('input', () => {
      const value = parseDecimal(el.value);
      if (!Number.isFinite(value) || value <= 0) return;
      state.size[axis] = Math.min(60, value);
      gridFromTarget();
      update();
    });
    el.addEventListener('blur', () => { render(); });
  };
  bind('#sizeW', 'w');
  bind('#sizeH', 'h');
}

function bindSelectors() {
  $('#moduleSelect').addEventListener('change', (e) => {
    const preset = MODULES.find((m) => m.id === e.target.value);
    if (!preset) return;
    state.moduleId = preset.id;
    state.module = { ...preset };
    state.signal.maxChain = preset.chain;
    gridFromTarget();
    update();
  });

  $('#procSelect').addEventListener('change', (e) => {
    const preset = PROCESSORS.find((p) => p.id === e.target.value);
    if (!preset) return;
    state.signal.processorId = preset.id;
    state.signal.ports = preset.ports;
    state.signal.pxPort60 = preset.pxPort60;
    state.signal.pxTotal = preset.pxTotal;
    update();
  });

  $('#rateTable').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-hz]');
    if (!row) return;
    state.signal.hz = Number(row.dataset.hz);
    update();
  });

  $$('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      setPath(state, seg.dataset.seg, btn.dataset.value);
      update();
    });
  });

  $$('[data-stepper]').forEach((box) => {
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-step]');
      if (!btn) return;
      const input = $('input', box);
      const next = clampNum(Number(getPath(state, box.dataset.stepper)) + Number(btn.dataset.step),
        Number(input.min), Number(input.max), Number(input.min));
      setPath(state, box.dataset.stepper, Math.round(next));
      syncTargetFromGrid();
      update();
    });
  });
}

/** Auf-/zugeklappte Bereiche merken. */
function bindSections() {
  $$('details.card[data-sec]').forEach((el) => {
    const key = el.dataset.sec;
    if (key in sections) el.open = sections[key];
    el.addEventListener('toggle', () => {
      sections[key] = el.open;
      saveSections(sections);
    });
  });
}

/* ------------------------------------------------------------------ Ansichten */

function bindTabs() {
  $$('.tabbar button').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.tab)));
}

function showView(name) {
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.tabbar button').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'projects') renderProjects();
  render();
  window.scrollTo({ top: 0 });
  try { sessionStorage.setItem('ledplan.tab', name); } catch { /* egal */ }
}

/* ------------------------------------------------------------------- Ausgabe */

const cornerLabel = (id) => START_CORNERS.find((c) => c.id === id)?.label ?? id;
const currentProcessor = () => PROCESSORS.find((p) => p.id === state.signal.processorId) ?? PROCESSORS.at(-1);
const barText = (f) =>
  f.mode === 'letterbox' ? `oben/unten je ${nf(f.barY)} px`
    : f.mode === 'pillarbox' ? `links/rechts je ${nf(f.barX)} px`
      : 'keine';

function deviationText() {
  const dw = calc.widthMm - state.size.w * 1000;
  const dh = calc.heightMm - state.size.h * 1000;
  const one = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${nf(Math.abs(Math.round(v)))} mm`;
  if (Math.abs(dw) < 1 && Math.abs(dh) < 1) return 'genau auf Modulmaß';
  return `B ${one(dw)} · H ${one(dh)}`;
}

function outputs() {
  const c = calc;
  const m = state.module;
  return {
    name: state.name,
    moduleLabel: m.label,
    procLabel: currentProcessor().label,
    pitch: `${nf(c.pitch, 2)} mm${c.pitchNonSquare ? ' (nicht quadratisch)' : ''}`,
    size: `${nf(c.widthMm / 1000, 2)} × ${nf(c.heightMm / 1000, 2)} m`,
    grid: `${c.cols} × ${c.rows} Module`,
    deviation: deviationText(),
    res: `${nf(c.resW)} × ${nf(c.resH)} px`,
    resShort: `${nf(c.count)} Module · ${nf(c.weight, 1)} kg`,
    count: `${nf(c.count)} ${c.count === 1 ? 'Modul' : 'Module'}`,
    area: `${nf(c.areaM2, 2)} m²`,
    ratio: `${c.ratioLabel} (${nf(c.ratio, 2)})`,
    diag: `${nf(c.diagM, 2)} m / ${nf(c.diagInch)} Zoll`,
    depth: `${nf(m.d)} mm`,
    weight: `${nf(c.weight, 1)} kg`,
    weightPerM: `${nf(c.weightPerM, 1)} kg/m`,
    weightPerCol: `${nf(c.weightPerCol, 1)} kg`,
    fitShort: `16:9 · ${nf(c.fitHD.usedPct, 1)} %`,
    fitUsed: `${nf(c.fitHD.usedPct, 1)} %`,
    fitHD: barText(c.fitHD),
    fitUHD: barText(c.fitUHD),
    hd: c.fitsHD ? 'ja' : `nein — Skalierung ${nf(c.scaleHD * 100)} %`,
    uhd: c.fits4K ? 'ja' : `nein — Skalierung ${nf(c.scale4K * 100)} %`,
    distMin: `${nf(c.distMin, 1)} m`,
    distComfort: `ab ${nf(c.distComfort, 1)} m`,
    distRetina: `${nf(c.distRetina, 1)} m`,
    pxModule: `${nf(c.pxPanel)} px (${m.px} × ${m.py})`,
    hzShort: `${c.hz} Hz`,
    pxPortNow: `${nf(c.pxPort)} px`,
    perPort: `${nf(c.maxPerPort)} Module (Budget ${nf(c.perPort)})`,
    limitedBy: c.portLimitedBy,
    portsNeeded: `${nf(c.portsNeeded)}${state.signal.redundancy ? ' (inkl. Redundanz)' : ''}`,
    processors: `${nf(c.processors)} × ${currentProcessor().label}`,
    portLoad: `${nf(c.portLoad)} %`,
    totalPx: `${nf(c.totalPx)} px (${nf(c.mpx, 2)} Mpx)`,
    sigRoute: `${state.signal.orientation === 'v' ? 'spaltenweise' : 'zeilenweise'}, ${cornerLabel(state.signal.start)}`,
    sigShort: `${nf(c.portsNeeded)} Ports · ${c.hz} Hz`,
    pmax: `${nf(c.pmax)} W`,
    pavg: `${nf(c.pavg)} W`,
    wm2: `${nf(c.wPerM2Max)} W/m² max · ${nf(c.wPerM2Avg)} W/m² ø`,
    circuits: `${nf(c.circuits)}`,
    perCircuit: `${nf(c.maxPerCircuit)} Module (Budget ${nf(c.perCircuit)}${state.power.manual ? ', manuell' : ''})`,
    circuitsPerPhase: `${nf(c.circuitsPerPhase)}`,
    ampsMax: `${nf(c.ampsMax, 1)} A${c.phases === 3 ? ' je Phase' : ''}`,
    ampsAvg: `${nf(c.ampsAvg, 1)} A${c.phases === 3 ? ' je Phase' : ''}`,
    feed: c.feed,
    circuitW: `${nf(c.circuitW)} W`,
    autoPerCircuit: `${nf(c.autoPerCircuit)} Module je Kreis`,
    netShort: `${state.power.volt} V · ${state.power.breaker} A · ${c.phases}-phasig`,
    powShort: `${nf(c.pmax / 1000, 1)} kW · ${nf(c.circuits)} Kreise`,
    overlayLabel: state.view.overlay === 'power' ? 'Stromgruppen' : state.view.overlay === 'data' ? 'Signalwege' : 'Raster',
    notesShort: state.notes ? `${state.notes.split('\n')[0].slice(0, 40)}…` : 'leer',
    pdfShort: '4 Seiten',
  };
}

const noteHtml = (level, text) => `<p class="note ${level}">${text}</p>`;

function signalNotes() {
  const out = [];
  if (calc.totalPx > state.signal.pxTotal) {
    out.push(noteHtml('bad', `Die Wand hat ${nf(calc.mpx, 2)} Mpx und überschreitet die Kapazität eines Geräts — ${calc.processors} Processoren einplanen.`));
  }
  if (calc.portsNeeded > calc.portsAvail) {
    out.push(noteHtml('warn', `${calc.portsNeeded} Ports nötig, das Gerät hat ${calc.portsAvail} — ${calc.processors} Geräte oder Ports mit mehr Pixelbudget.`));
  }
  if (calc.portLoad > 90) {
    out.push(noteHtml('warn', `Höchste Portlast ${nf(calc.portLoad)} % bei ${calc.hz} Hz. Für höhere Bildrate oder Farbtiefe Reserve lassen.`));
  } else if (calc.portLoad < 40 && calc.portsUsed > 1) {
    out.push(noteHtml('ok', `Ports sind nur zu ${nf(calc.portLoad)} % belegt — die Kettenlänge begrenzt hier, nicht das Pixelbudget.`));
  }
  if (state.signal.redundancy) {
    out.push(noteHtml('ok', `Redundanz aktiv: ${calc.portsUsed} Ports Hauptweg + ${calc.portsUsed} Ports Backup.`));
  }
  if (!out.length) out.push(noteHtml('ok', 'Signalweg passt in ein Gerät mit Reserve.'));
  return out.join('');
}

function powerNotes() {
  const out = [];
  if (state.power.manual && state.power.perCircuit > calc.autoPerCircuit) {
    out.push(noteHtml('bad', `${state.power.perCircuit} Module je Kreis liegen über der berechneten Belastbarkeit von ${calc.autoPerCircuit}.`));
  }
  if (state.power.useAvg) {
    out.push(noteHtml('warn', 'Rechnung auf Durchschnittsleistung: bei Weißbild oder hoher Helligkeit fliegt die Sicherung.'));
  }
  if (calc.phases === 3) {
    out.push(noteHtml('ok', `${calc.circuits} Kreise auf 3 Phasen verteilen: ${calc.circuitsPerPhase} je Phase, möglichst spaltenweise abwechselnd.`));
  }
  out.push(noteHtml('ok', 'Einschaltstrom beachten: LED-Netzteile ziehen kurzzeitig ein Vielfaches — Automaten mit Charakteristik C oder D.'));
  return out.join('');
}

function rateTable() {
  const pxModule = calc.pxPanel;
  let capped = false;
  const rows = REFRESH_RATES.map((hz) => {
    const px = pxPortAt(state.signal.pxPort60, hz);
    const budget = Math.max(1, Math.floor(px / pxModule));
    const limited = budget > state.signal.maxChain;
    if (limited) capped = true;
    const perPort = limited ? state.signal.maxChain : budget;
    return `<tr data-hz="${hz}"${hz === calc.hz ? ' class="current"' : ''}>` +
      `<td>${hz} Hz</td><td>${nf(px)}</td><td>${nf(perPort)}${limited ? ' *' : ''}</td></tr>`;
  }).join('');
  const foot = capped
    ? `<tfoot><tr><td colspan="3">* durch das Daisy-Chain-Limit von ${nf(state.signal.maxChain)} Modulen begrenzt</td></tr></tfoot>`
    : '';
  return `<thead><tr><th>Bildrate</th><th>px je Port</th><th>Module je Port</th></tr></thead><tbody>${rows}</tbody>${foot}`;
}

function report() {
  const o = outputs();
  const chains = calc.dataChains
    .map((ch, i) => `  Port ${String(i + 1).padStart(2)} : ${String(ch.cells.length).padStart(3)} Module · ${nf(ch.px)} px`)
    .join('\n');
  const circuits = calc.powerChains
    .map((ch, i) => `  Kreis ${String(i + 1).padStart(2)}: ${String(ch.cells.length).padStart(3)} Module · ${nf(Math.round(ch.watt))} W`)
    .join('\n');
  return [
    `${state.name}`,
    `${new Date().toLocaleDateString('de-DE')}`,
    '',
    'WAND',
    `  Modul        ${state.module.label} (${state.module.w}×${state.module.h}×${state.module.d} mm, ${state.module.px}×${state.module.py} px)`,
    `  Raster       ${calc.cols} × ${calc.rows} = ${calc.count} Module`,
    `  Maß          ${o.size}  (${o.area})`,
    `  Auflösung    ${o.res}  ·  ${o.ratio}`,
    `  Pixelabstand ${o.pitch}`,
    `  Gewicht      ${o.weight}  (${o.weightPerM} Traglast je Meter)`,
    `  16:9-Bild    ${o.fitUsed} genutzt, Ränder ${o.fitHD}`,
    `  Abstand      ab ${o.distMin} sichtbar homogen, voll aufgelöst ${o.distRetina}`,
    '',
    'SIGNAL',
    `  Processor    ${o.processors}`,
    `  Pixelbudget  ${nf(calc.pxPort)} px/Port bei ${calc.hz} Hz · ${o.perPort} (${o.limitedBy})`,
    `  Ports        ${o.portsNeeded}  ·  höchste Last ${o.portLoad}`,
    `  Führung      ${o.sigRoute}${state.signal.serpentine ? ', Schlangenlinie' : ''}`,
    chains,
    '',
    'STROM',
    `  Netz         ${o.netShort}, ${state.power.derate} % Ausnutzung`,
    `  Leistung     ${o.pmax} max · ${o.pavg} ø  (${o.wm2})`,
    `  Strom        ${o.ampsMax} max · ${o.ampsAvg} ø`,
    `  Einspeisung  ${o.feed}`,
    `  Kreise       ${o.circuits} × ${o.perCircuit}`,
    circuits,
    state.notes ? `\nNOTIZEN\n${state.notes.split('\n').map((l) => '  ' + l).join('\n')}` : '',
  ].join('\n');
}

/* ------------------------------------------------------------------- Rendern */

function update() {
  calc = computeAll(state);
  saveCurrent(state);
  render();
}

function render() {
  const values = outputs();

  $$('[data-out]').forEach((el) => {
    const key = el.dataset.out;
    if (key in values) el.textContent = values[key];
  });

  $$('[data-bind]').forEach((el) => {
    if (el === document.activeElement) return;
    const value = getPath(state, el.dataset.bind);
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value ?? '';
  });

  for (const [id, axis] of [['#sizeW', 'w'], ['#sizeH', 'h']]) {
    const el = $(id);
    if (el !== document.activeElement) el.value = nf(state.size[axis], 2);
  }

  $('#moduleSelect').value = state.moduleId;
  $('#procSelect').value = state.signal.processorId;
  $('#hzSelect').value = String(state.signal.hz);
  $('#moduleNote').textContent = state.module.note || '—';
  $('#procNote').textContent = currentProcessor().note;
  $('#rateTable').innerHTML = rateTable();

  $$('.seg').forEach((seg) => {
    const current = String(getPath(state, seg.dataset.seg));
    $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === current)));
  });

  $('#perCircuitField').hidden = !state.power.manual;
  $('#summary').textContent =
    `${values.size} · ${values.res} · ${values.count} · ${nf(calc.weight)} kg · ${nf(calc.pmax / 1000, 1)} kW`;

  $('#signalNotes').innerHTML = signalNotes();
  $('#powerNotes').innerHTML = powerNotes();
  if (!$('#view-wall').hidden) $('#fitGraphic').innerHTML = renderFit(calc);

  const wall = $('#wall');
  wall.classList.toggle('zoom', !!state.view.zoom);
  wall.style.setProperty('--cols', calc.cols);

  // Die Grafik nur zeichnen, wenn sie sichtbar ist — bei großen Rastern teuer.
  if (!$('#view-plan').hidden) {
    if (calc.count > 3000) {
      wall.innerHTML = '<p class="hint">Raster zu groß für die Vorschau. Kennzahlen und Zusammenfassung bleiben gültig.</p>';
    } else {
      wall.innerHTML = renderWall(state, calc);
    }
    $('#legend').innerHTML = renderLegend(state, calc);
    $('#report').textContent = report();
  }
}

/* -------------------------------------------------------------------- Aktionen */

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => (s || 'led-wall').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'led-wall';

function bindActions() {
  $('#copyReport').addEventListener('click', async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      toast('Zusammenfassung kopiert');
    } catch {
      download(`${slug(state.name)}.txt`, text, 'text/plain');
      toast('Als Datei gespeichert');
    }
  });

  $('#exportSvg').addEventListener('click', () => {
    download(`${slug(state.name)}-plan.svg`, renderWall(state, calc, { standalone: true }), 'image/svg+xml');
    toast('Plan exportiert');
  });

  $('#printPlan').addEventListener('click', () => window.print());

  // Zum Drucken alle Bereiche aufklappen — zugeklappte Inhalte kaemen sonst
  // nicht mit aufs Papier.
  let reopened = [];
  window.addEventListener('beforeprint', () => {
    reopened = $$('details.card:not([open])');
    reopened.forEach((el) => { el.open = true; });
  });
  window.addEventListener('afterprint', () => {
    reopened.forEach((el) => { el.open = false; });
    reopened = [];
  });

  $('#exportPdf').addEventListener('click', () => {
    try {
      const pdf = buildPdf(state, calc, {
        numbers: $('#pdfNumbers').checked,
        lists: $('#pdfLists').checked,
        landscape: $('#pdfLandscape').checked,
      });
      download(`${slug(state.name)}-baumappe.pdf`, pdf, 'application/pdf');
      toast('PDF erstellt');
    } catch (err) {
      toast('PDF fehlgeschlagen');
      console.error(err);
    }
  });

  $('#saveProject').addEventListener('click', () => {
    storeProject(state);
    renderProjects();
    toast(`„${state.name}“ gespeichert`);
  });

  $('#newProject').addEventListener('click', () => {
    if (!confirm('Neues Projekt anlegen? Nicht gespeicherte Änderungen gehen verloren.')) return;
    state = defaultState();
    update();
    showView('wall');
  });

  $('#exportJson').addEventListener('click', () => {
    download(`${slug(state.name)}.json`, JSON.stringify(state, null, 2), 'application/json');
    toast('Projektdatei exportiert');
  });

  $('#importJson').addEventListener('click', () => $('#importFile').click());

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state = migrate(JSON.parse(await file.text()));
      update();
      showView('wall');
      toast('Projekt geladen');
    } catch {
      toast('Datei konnte nicht gelesen werden');
    }
    e.target.value = '';
  });
}

/* ------------------------------------------------------------------ Projekte */

function renderProjects() {
  const all = listProjects();
  const box = $('#projectList');
  $('#projectCount').textContent = all.length ? `${all.length}` : 'keine';
  if (!all.length) {
    box.innerHTML = '<p class="hint">Noch keine Projekte gespeichert.</p>';
    return;
  }
  box.innerHTML = all
    .map((p, i) => {
      const mod = p.module?.label ?? p.panel?.label ?? 'Modul';
      const info = `${p.grid.cols} × ${p.grid.rows} · ${mod}`;
      const date = new Date(p.savedAt || Date.now()).toLocaleDateString('de-DE');
      return `<div class="project"><div class="project-main"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(info)} · ${date}</small></div>
        <button type="button" class="ghost" data-load="${i}">Laden</button>
        <button type="button" class="danger" data-del="${i}" aria-label="Projekt löschen">✕</button></div>`;
    })
    .join('');

  $$('[data-load]', box).forEach((btn) => btn.addEventListener('click', () => {
    state = migrate(all[Number(btn.dataset.load)]);
    update();
    showView('wall');
    toast(`„${state.name}“ geladen`);
  }));

  $$('[data-del]', box).forEach((btn) => btn.addEventListener('click', () => {
    const project = all[Number(btn.dataset.del)];
    if (!confirm(`„${project.name}“ löschen?`)) return;
    deleteProject(project.name);
    renderProjects();
  }));
}

/* ------------------------------------------------------- PWA: Update & Install */

function initPwa() {
  $('#appVersion').textContent = `Version ${APP_VERSION}`;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Neue Version — App neu starten');
            }
          });
        });
      }).catch(() => { /* z. B. ohne HTTPS: App laeuft trotzdem */ });
    });
  }

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });
}

/* ---------------------------------------------------------------------- Start */

fillSelects();
bindInputs();
bindSizeFields();
bindSelectors();
bindSections();
bindTabs();
bindActions();
initPwa();

const VIEWS = ['wall', 'signal', 'power', 'plan', 'projects'];
const fromHash = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : null;
let startView = 'wall';
try {
  startView = fromHash || sessionStorage.getItem('ledplan.tab') || 'wall';
} catch {
  startView = fromHash || 'wall';
}
showView(VIEWS.includes(startView) ? startView : 'wall');
