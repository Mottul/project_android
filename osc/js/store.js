/** Speichern im Geraet (localStorage). Kein Konto, kein Server. */

import { normalizeProject } from './model.js';
import { starterProject } from './presets.js';
import { defaultBridgeUrl } from './conn.js';

const K_PROJECT = 'osc.project';
const K_SETTINGS = 'osc.settings';
const K_LIBRARY = 'osc.library';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function defaultSettings() {
  return {
    url: defaultBridgeUrl(),
    target: { host: '127.0.0.1', port: 8000 },
    listenPort: 9000,
    nova: { host: '', port: 5200 },
    autoConnect: true,
    wakeLock: true,
    haptics: true,
    locked: false,
  };
}

export function loadSettings() {
  const s = { ...defaultSettings(), ...read(K_SETTINGS, {}) };
  s.target = { ...defaultSettings().target, ...(s.target || {}) };
  s.nova = { ...defaultSettings().nova, ...(s.nova || {}) };
  s.url = String(s.url || defaultBridgeUrl());
  return s;
}

export const saveSettings = (s) => write(K_SETTINGS, s);

export function loadProject() {
  const raw = read(K_PROJECT, null);
  return raw ? normalizeProject(raw) : starterProject();
}

export const saveProject = (p) => write(K_PROJECT, p);

/** Bibliothek: mehrere gespeicherte Projekte (Name -> Projekt). */
export const loadLibrary = () => {
  const list = read(K_LIBRARY, []);
  return Array.isArray(list) ? list : [];
};

export function storeInLibrary(project) {
  const list = loadLibrary().filter((p) => p.id !== project.id);
  list.unshift({ ...JSON.parse(JSON.stringify(project)), savedAt: Date.now() });
  write(K_LIBRARY, list.slice(0, 30));
  return list;
}

export function removeFromLibrary(id) {
  const list = loadLibrary().filter((p) => p.id !== id);
  write(K_LIBRARY, list);
  return list;
}
