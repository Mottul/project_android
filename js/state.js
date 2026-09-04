/** Projekt-State, Defaults und Persistenz (localStorage). */

import { PANELS, PROCESSORS } from './data.js';

const KEY_CURRENT = 'ledplan.current';
const KEY_PROJECTS = 'ledplan.projects';

export function defaultState() {
  const panel = PANELS.find((p) => p.id === 'p2.6-500');
  const proc = PROCESSORS[0];
  return {
    version: 1,
    name: 'Neues Projekt',
    panelId: panel.id,
    panel: { ...panel },
    grid: { cols: 12, rows: 6 },
    signal: {
      processorId: proc.id,
      ports: proc.ports,
      pxPort: proc.pxPort,
      pxTotal: proc.pxTotal,
      maxChain: panel.chain,
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

/** Fuegt fehlende Felder aus den Defaults ein (Vorwaertskompatibilitaet). */
export function migrate(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  for (const key of ['panel', 'grid', 'signal', 'power', 'view']) {
    merged[key] = { ...base[key], ...(raw[key] || {}) };
  }
  merged.grid.cols = clampInt(merged.grid.cols, 1, 200, base.grid.cols);
  merged.grid.rows = clampInt(merged.grid.rows, 1, 200, base.grid.rows);
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
