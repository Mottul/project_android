/** Anwendungslogik: Bindings, Ansichten, Export, Persistenz. */

import { PANELS, PROCESSORS, START_CORNERS } from './data.js';
import { computeAll } from './calc.js';
import { renderWall, renderLegend } from './render.js';
import {
  defaultState, loadCurrent, saveCurrent, listProjects, storeProject, deleteProject, migrate, clampNum,
} from './state.js';

export const APP_VERSION = '1.0.0';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const nf = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const m = (mm) => nf(mm / 1000, 2) + ' m';

let state = loadCurrent();
let calc = computeAll(state);

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
  $('#panelSelect').innerHTML = PANELS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  $('#procSelect').innerHTML = PROCESSORS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  const corners = START_CORNERS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $$('select[data-corners]').forEach((el) => { el.innerHTML = corners; });
}

/* ------------------------------------------------------------- Eingabe-Bindung */

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') {
    const min = el.min === '' ? -Infinity : Number(el.min);
    const max = el.max === '' ? Infinity : Number(el.max);
    const fallback = Number(getPath(state, el.dataset.bind)) || min;
    return clampNum(el.value, min, max, Number.isFinite(fallback) ? fallback : 0);
  }
  if (el.dataset.number !== undefined) return Number(el.value);
  return el.value;
}

function bindInputs() {
  $$('[data-bind]').forEach((el) => {
    const path = el.dataset.bind;
    const commit = () => {
      setPath(state, path, readInput(el));
      if (path.startsWith('panel.')) markCustomPanel();
      if (path.startsWith('signal.p') || path === 'signal.ports') markCustomProcessor();
      update();
    };
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', commit);
    // Beim Verlassen den geklemmten Wert zurückschreiben (z. B. „0“ Spalten).
    if (el.type === 'number') el.addEventListener('blur', () => { el.value = getPath(state, path); });
  });
}

function markCustomPanel() {
  if (state.panelId !== 'custom') {
    state.panelId = 'custom';
    state.panel.label = 'Eigenes Panel';
  }
}

function markCustomProcessor() {
  if (state.signal.processorId !== 'custom-p') state.signal.processorId = 'custom-p';
}

function bindSelectors() {
  $('#panelSelect').addEventListener('change', (e) => {
    const preset = PANELS.find((p) => p.id === e.target.value);
    if (!preset) return;
    state.panelId = preset.id;
    state.panel = { ...preset };
    state.signal.maxChain = preset.chain;
    update();
  });

  $('#procSelect').addEventListener('change', (e) => {
    const preset = PROCESSORS.find((p) => p.id === e.target.value);
    if (!preset) return;
    state.signal.processorId = preset.id;
    state.signal.ports = preset.ports;
    state.signal.pxPort = preset.pxPort;
    state.signal.pxTotal = preset.pxTotal;
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
      setPath(state, box.dataset.stepper, next);
      update();
    });
  });
}

/* ------------------------------------------------------------------ Ansichten */

function bindTabs() {
  $$('.tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.tab));
  });
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
  if (name === 'plan') render();
  window.scrollTo({ top: 0 });
  try { sessionStorage.setItem('ledplan.tab', name); } catch { /* egal */ }
}

/* ------------------------------------------------------------------- Ausgabe */

/** Empfohlene Einspeisung: kleinster passender Standard-Anschluss. */
function standardFeed(ampsPerPhase, phases) {
  const sizes = [16, 32, 63, 125];
  const need = ampsPerPhase / 0.8;
  const size = sizes.find((s) => s >= need);
  if (!size) return `${nf(Math.ceil(need))} A je Phase (Sonderverteilung)`;
  return phases === 3 ? `CEE ${size} A, 5-polig` : `${size} A einphasig`;
}

function outputs() {
  const c = calc;
  const p = state.panel;
  return {
    pitch: `${nf(c.pitch, 2)} mm${c.pitchNonSquare ? ' (nicht quadratisch)' : ''}`,
    size: `${nf(c.widthMm / 1000, 2)} × ${nf(c.heightMm / 1000, 2)} m`,
    res: `${nf(c.resW)} × ${nf(c.resH)} px`,
    count: `${nf(c.count)} ${c.count === 1 ? 'Panel' : 'Panels'}`,
    area: `${nf(c.areaM2, 2)} m²`,
    ratio: `${c.ratioLabel} (${nf(c.ratio, 2)})`,
    diag: `${nf(c.diagM, 2)} m / ${nf(c.diagInch)}″`,
    weight: `${nf(c.weight, 1)} kg`,
    weightPerM: `${nf(c.weightPerM, 1)} kg/m`,
    weightPerCol: `${nf(c.weightPerCol, 1)} kg`,
    hd: c.fitsHD ? 'ja' : `nein — Skalierung ${nf(c.scaleHD * 100)} %`,
    uhd: c.fits4K ? 'ja' : `nein — Skalierung ${nf(c.scale4K * 100)} %`,
    distMin: `${nf(c.distMin, 1)} m`,
    distComfort: `ab ${nf(c.distComfort, 1)} m`,
    distRetina: `${nf(c.distRetina, 1)} m`,
    pxPanel: `${nf(c.pxPanel)} px (${p.px} × ${p.py})`,
    perPort: `${nf(c.maxPerPort)} Panels (Budget ${nf(c.perPort)})`,
    limitedBy: c.portLimitedBy,
    portsNeeded: `${nf(c.portsNeeded)}${state.signal.redundancy ? ' (inkl. Redundanz)' : ''}`,
    processors: `${nf(c.processors)} × ${PROCESSORS.find((x) => x.id === state.signal.processorId)?.label ?? 'Processor'}`,
    portLoad: `${nf(c.portLoad)} %`,
    totalPx: `${nf(c.totalPx)} px (${nf(c.mpx, 2)} Mpx)`,
    pmax: `${nf(c.pmax)} W`,
    pavg: `${nf(c.pavg)} W`,
    wm2: `${nf(c.wPerM2Max)} W/m² max · ${nf(c.wPerM2Avg)} W/m² ø`,
    circuits: `${nf(c.circuits)}`,
    perCircuit: `${nf(c.maxPerCircuit)} Panels (Budget ${nf(c.perCircuit)}${state.power.manual ? ', manuell' : ''})`,
    circuitsPerPhase: `${nf(c.circuitsPerPhase)}`,
    ampsMax: `${nf(c.ampsMax, 1)} A${c.phases === 3 ? ' je Phase' : ''}`,
    ampsAvg: `${nf(c.ampsAvg, 1)} A${c.phases === 3 ? ' je Phase' : ''}`,
    feed: standardFeed(c.ampsMax, c.phases),
    circuitW: `${nf(c.circuitW)} W`,
    autoPerCircuit: `${nf(c.autoPerCircuit)} Panels je Kreis`,
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
    out.push(noteHtml('warn', `Höchste Portlast ${nf(calc.portLoad)} %. Für höhere Bildrate oder Farbtiefe Reserve lassen.`));
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
    out.push(noteHtml('bad', `${state.power.perCircuit} Panels je Kreis liegen über der berechneten Belastbarkeit von ${calc.autoPerCircuit}.`));
  }
  if (state.power.useAvg) {
    out.push(noteHtml('warn', 'Rechnung auf Durchschnittsleistung: bei Weißbild oder hoher Helligkeit fliegt die Sicherung.'));
  }
  if (calc.phases === 3) {
    out.push(noteHtml('ok', `${calc.circuits} Kreise auf 3 Phasen verteilen: ${calc.circuitsPerPhase} je Phase, möglichst spaltenweise abwechselnd.`));
  }
  out.push(noteHtml('ok', `Einschaltstrom beachten: LED-Netzteile ziehen kurzzeitig ein Vielfaches — Automaten mit Charakteristik C oder D.`));
  return out.join('');
}

function report() {
  const o = outputs();
  const chains = calc.dataChains
    .map((ch, i) => `  Port ${String(i + 1).padStart(2)} : ${String(ch.cells.length).padStart(3)} Panels · ${nf(ch.px)} px`)
    .join('\n');
  const circuits = calc.powerChains
    .map((ch, i) => `  Kreis ${String(i + 1).padStart(2)}: ${String(ch.cells.length).padStart(3)} Panels · ${nf(Math.round(ch.watt))} W`)
    .join('\n');
  return [
    `${state.name}`,
    `${new Date().toLocaleDateString('de-DE')}`,
    '',
    'WAND',
    `  Panel        ${state.panel.label} (${state.panel.w}×${state.panel.h} mm, ${state.panel.px}×${state.panel.py} px)`,
    `  Raster       ${calc.cols} × ${calc.rows} = ${calc.count} Panels`,
    `  Maß          ${o.size}  (${o.area})`,
    `  Auflösung    ${o.res}  ·  ${o.ratio}`,
    `  Pixelabstand ${o.pitch}`,
    `  Gewicht      ${o.weight}  (${o.weightPerM} Traglast je Meter)`,
    `  Abstand      ab ${o.distMin} sichtbar homogen, voll aufgelöst ${o.distRetina}`,
    '',
    'SIGNAL',
    `  Processor    ${o.processors}`,
    `  Pixelbudget  ${nf(state.signal.pxPort)} px/Port · ${o.perPort} je Port (${o.limitedBy})`,
    `  Ports        ${o.portsNeeded} × ${o.perPort}  ·  höchste Last ${o.portLoad}`,
    `  Führung      ${state.signal.orientation === 'v' ? 'spaltenweise' : 'zeilenweise'}, Start ${cornerLabel(state.signal.start)}${state.signal.serpentine ? ', Schlangenlinie' : ''}`,
    chains,
    '',
    'STROM',
    `  Netz         ${state.power.volt} V, ${state.power.breaker} A, ${state.power.derate} % Ausnutzung, ${calc.phases}-phasig`,
    `  Leistung     ${o.pmax} max · ${o.pavg} ø  (${o.wm2})`,
    `  Strom        ${o.ampsMax} max · ${o.ampsAvg} ø`,
    `  Einspeisung  ${o.feed}`,
    `  Kreise       ${o.circuits} × ${o.perCircuit}`,
    circuits,
    state.notes ? `\nNOTIZEN\n${state.notes.split('\n').map((l) => '  ' + l).join('\n')}` : '',
  ].join('\n');
}

const cornerLabel = (id) => START_CORNERS.find((c) => c.id === id)?.label ?? id;

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

  $('#panelSelect').value = state.panelId;
  $('#procSelect').value = state.signal.processorId;

  $$('.seg').forEach((seg) => {
    const current = String(getPath(state, seg.dataset.seg));
    $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === current)));
  });

  $('#perCircuitField').hidden = !state.power.manual;
  $('#summary').textContent =
    `${values.size} · ${values.res} · ${values.count} · ${nf(calc.weight)} kg · ${nf(calc.pmax / 1000, 1)} kW`;

  $('#signalNotes').innerHTML = signalNotes();
  $('#powerNotes').innerHTML = powerNotes();

  // Die Grafik nur zeichnen, wenn sie sichtbar ist — bei großen Rastern teuer.
  const wall = $('#wall');
  wall.classList.toggle('zoom', !!state.view.zoom);
  wall.style.setProperty('--cols', calc.cols);

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

const slug = (s) => (s || 'led-wall').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'led-wall';

function bindActions() {
  $('#fitDown').addEventListener('click', () => fitToTarget(Math.floor));
  $('#fitUp').addEventListener('click', () => fitToTarget(Math.ceil));

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

function fitToTarget(round) {
  const w = Number($('#targetW').value);
  const h = Number($('#targetH').value);
  if (w > 0) state.grid.cols = Math.max(1, round((w * 1000) / state.panel.w));
  if (h > 0) state.grid.rows = Math.max(1, round((h * 1000) / state.panel.h));
  update();
  toast(`Raster ${state.grid.cols} × ${state.grid.rows}`);
}

/* ------------------------------------------------------------------ Projekte */

function renderProjects() {
  const all = listProjects();
  const box = $('#projectList');
  if (!all.length) {
    box.innerHTML = '<p class="hint">Noch keine Projekte gespeichert.</p>';
    return;
  }
  box.innerHTML = all
    .map((p, i) => {
      const grid = `${p.grid.cols} × ${p.grid.rows} · ${p.panel.label}`;
      const date = new Date(p.savedAt || Date.now()).toLocaleDateString('de-DE');
      return `<div class="project"><div class="project-main"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(grid)} · ${date}</small></div>
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

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------- PWA: Update & Install */

function initPwa() {
  $('#appVersion').textContent = APP_VERSION;

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
bindSelectors();
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
render();
