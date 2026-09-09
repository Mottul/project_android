/**
 * Fertige Startseiten. Die Adressen sind Vorschlaege — welche Adresse ein
 * Bedienelement in MadMapper wirklich steuert, legt man dort ueber „OSC lernen"
 * fest: Regler in MadMapper auswaehlen, Lernen einschalten, hier den Fader
 * bewegen. Danach passt die Adresse, egal wie sie heisst.
 *
 * Die NovaStar-Seite nutzt die Sonderadressen /nova/... — die Bruecke
 * uebersetzt sie in das TCP-Protokoll des Prozessors (Port 5200).
 */

import { makeWidget, makePage, makeProject, COLORS, placeMissing } from './model.js';

const w = (type, over) => makeWidget(type, over);

/** MadMapper: Master, Surfaces, Cues, Position, Farbe. */
function madmapperPage() {
  const widgets = [
    w('label', { label: 'MadMapper', align: 'left', color: COLORS[8], gx: 0, gy: 0, cw: 12, ch: 1 }),

    w('fader', { label: 'Master', address: '/master/opacity', color: COLORS[0], gx: 0, gy: 1, cw: 3, ch: 7 }),
    w('fader', { label: 'Surface 1', address: '/surfaces/1/opacity', color: COLORS[7], gx: 3, gy: 1, cw: 3, ch: 7 }),
    w('fader', { label: 'Surface 2', address: '/surfaces/2/opacity', color: COLORS[7], gx: 6, gy: 1, cw: 3, ch: 7 }),
    w('fader', { label: 'Surface 3', address: '/surfaces/3/opacity', color: COLORS[7], gx: 9, gy: 1, cw: 3, ch: 7 }),

    w('toggle', { label: 'Blackout', address: '/master/blackout', color: COLORS[4], gx: 0, gy: 8, cw: 6, ch: 2 }),
    w('button', { label: 'BPM Tap', address: '/master/bpm/tap', color: COLORS[2], gx: 6, gy: 8, cw: 6, ch: 2 }),

    w('bank', {
      label: 'Cues', color: COLORS[1], bankMode: 'momentary', cols: 4,
      gx: 0, gy: 10, cw: 12, ch: 4,
      items: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: String(n), address: `/cues/${n}/recall`, value: 0 })),
    }),

    w('xy', {
      label: 'Position S1', address: '/surfaces/1/position/x', addressY: '/surfaces/1/position/y',
      color: COLORS[6], gx: 0, gy: 14, cw: 6, ch: 5,
    }),
    w('color', { label: 'Farbe S1', address: '/surfaces/1/color', color: COLORS[5], gx: 6, gy: 14, cw: 6, ch: 5 }),
  ];
  return makePage('MadMapper', { columns: 12, widgets, fit: false });
}

/** NovaStar-Prozessor ueber die Bruecke (TCP 5200). */
function novastarPage() {
  const widgets = [
    w('label', { label: 'NovaStar', align: 'left', color: COLORS[8], gx: 0, gy: 0, cw: 12, ch: 1 }),

    w('fader', {
      label: 'Helligkeit', address: '/nova/brightness', color: COLORS[2],
      min: 0, max: 100, value: 80, gx: 0, gy: 1, cw: 4, ch: 8,
    }),
    w('select', {
      label: 'Schnellwahl %', address: '/nova/brightness', color: COLORS[2], cols: 1,
      gx: 4, gy: 1, cw: 4, ch: 8,
      items: [100, 80, 60, 40, 20].map((n) => ({ label: `${n} %`, address: '', value: n })),
    }),
    w('meter', {
      label: 'Rueckmeldung', address: '/nova/state', color: COLORS[8], source: 'text',
      gx: 8, gy: 1, cw: 4, ch: 3,
    }),
    w('toggle', { label: 'Blackout', address: '/nova/blackout', color: COLORS[4], gx: 8, gy: 4, cw: 4, ch: 2 }),
    w('toggle', { label: 'Freeze', address: '/nova/freeze', color: COLORS[0], gx: 8, gy: 6, cw: 4, ch: 3 }),

    w('bank', {
      label: 'Presets', color: COLORS[1], bankMode: 'momentary', cols: 4,
      gx: 0, gy: 9, cw: 12, ch: 3,
      items: [1, 2, 3, 4].map((n) => ({ label: `P${n}`, address: '/nova/preset', value: n })),
    }),
    w('label', {
      label: 'Adressen /nova/... werden von der Bruecke in NovaStar-Befehle uebersetzt.',
      align: 'left', color: COLORS[8], gx: 0, gy: 12, cw: 12, ch: 2,
    }),
  ];
  return makePage('NovaStar', { columns: 12, widgets, fit: false });
}

/** Leere Seite zum freien Aufbauen. */
function leerePage() {
  return makePage('Neue Seite', { columns: 12, widgets: [], fit: false });
}

export const PRESETS = [
  { id: 'madmapper', name: 'MadMapper', hint: 'Master, Surfaces, Cues, Position, Farbe', build: madmapperPage },
  { id: 'novastar', name: 'NovaStar', hint: 'Helligkeit, Blackout, Freeze, Presets', build: novastarPage },
  { id: 'leer', name: 'Leer', hint: 'leeres Raster', build: leerePage },
];

export function buildPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[2];
  const page = p.build();
  placeMissing(page.widgets, page.columns);
  return page;
}

/** Startprojekt beim allerersten Oeffnen: beide Vorlagen als Seiten. */
export function starterProject() {
  return makeProject('Show', [buildPreset('madmapper'), buildPreset('novastar')]);
}
