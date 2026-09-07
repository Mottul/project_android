/** Projekt-State, Defaults und Persistenz (localStorage). */

import { MODULES, PROCESSORS } from './data.js';

const KEY_CURRENT = 'ledplan.current';
const KEY_PROJECTS = 'ledplan.projects';
const KEY_SECTIONS = 'ledplan.sections';

export function defaultState() {
  const mod = MODULES[0];
  const proc = PROCESSORS[0];
  return {
    version: 2,
    name: 'Neues Projekt',
    moduleId: mod.id,
    module: { ...mod },
    grid: { cols: 12, rows: 6 },
    // Zielmaß in Metern — die Modulzahl wird daraus gerundet.
    size: { w: (12 * mod.w) / 1000, h: (6 * mod.h) / 1000 },
    signal: {
      processorId: proc.id,
      ports: proc.ports,
      pxPort60: proc.pxPort60,
      pxTotal: proc.pxTotal,
      hz: 60,
      maxChain: mod.chain,
      orientation: 'v',
      start: 'tl',
      serpentine: true,
      redundancy: false,
    },
    power: {
      volt: 230,
      breaker: 16,
      derate: 80,
      useAvg: false,
      manual: false,
      perCircuit: 8,
      phases: 3,
      orientation: 'v',
      start: 'tl',
      serpentine: true,
    },
    view: { overlay: 'data', numbers: true, dims: true, zoom: false },
    notes: '',
  };
}

/**
 * Fuegt fehlende Felder aus den Defaults ein und hebt Projekte aus Version 1
 * an (dort hiessen die Module noch `panel`, und `pxPort` war absolut statt
 * auf 60 Hz bezogen).
 */
export function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;

  const input = { ...raw };
  if (input.panel && !input.module) {
    input.module = input.panel;
    input.moduleId = 'custom';
  }
  if (input.signal?.pxPort && !input.signal.pxPort60) {
    input.signal = { ...input.signal, pxPort60: input.signal.pxPort };
  }
  delete input.panel;
  delete input.panelId;

  const merged = { ...base, ...input };
  for (const key of ['module', 'grid', 'size', 'signal', 'power', 'view']) {
    merged[key] = { ...base[key], ...(input[key] || {}) };
  }
  delete merged.signal.pxPort;

  // Unbekannte Presets als „eigenes“ fuehren, die Werte selbst bleiben erhalten.
  if (!MODULES.some((m) => m.id === merged.moduleId)) merged.moduleId = 'custom';
  if (!PROCESSORS.some((p) => p.id === merged.signal.processorId)) merged.signal.processorId = 'custom-p';

  merged.grid.cols = clampInt(merged.grid.cols, 1, 100, base.grid.cols);
  merged.grid.rows = clampInt(merged.grid.rows, 1, 100, base.grid.rows);
  if (!input.size) {
    merged.size = {
      w: (merged.grid.cols * merged.module.w) / 1000,
      h: (merged.grid.rows * merged.module.h) / 1000,
    };
  }
  merged.version = base.version;
  return merged;
}

export function clampInt(value, min, max, fallback = min) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampNum(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Zahl aus einem Eingabefeld lesen — „6,25“ und „6.25“ sind beide erlaubt. */
export function parseDecimal(text) {
  const n = Number(String(text).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export function loadCurrent() {
  try {
    return migrate(JSON.parse(localStorage.getItem(KEY_CURRENT)));
  } catch {
    return defaultState();
  }
}

export function saveCurrent(state) {
  try {
    localStorage.setItem(KEY_CURRENT, JSON.stringify(state));
  } catch {
    /* Speicher voll oder gesperrt — Planung laeuft trotzdem weiter. */
  }
}

export function listProjects() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_PROJECTS));
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/** Speichert unter dem Projektnamen; gleichnamige Eintraege werden ersetzt. */
export function storeProject(state) {
  const all = listProjects().filter((p) => p.name !== state.name);
  all.unshift({ ...structuredClone(state), savedAt: Date.now() });
  localStorage.setItem(KEY_PROJECTS, JSON.stringify(all.slice(0, 50)));
  return all;
}

export function deleteProject(name) {
  const all = listProjects().filter((p) => p.name !== name);
  localStorage.setItem(KEY_PROJECTS, JSON.stringify(all));
  return all;
}

/** Auf-/zugeklappte Bereiche merken, damit die App so bleibt wie eingerichtet. */
export function loadSections() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_SECTIONS));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveSections(map) {
  try {
    localStorage.setItem(KEY_SECTIONS, JSON.stringify(map));
  } catch {
    /* egal */
  }
}
