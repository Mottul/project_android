/**
 * Fertige Startseiten.
 *
 * Die MadMapper-Seiten benutzen die FESTEN Adressen, die MadMapper von sich
 * aus kennt — sie funktionieren also ohne „OSC lernen". Quelle:
 * https://docs.madmapper.com/madmapper/6/11.-live-performance-and-control/osc-commands-and-channels-list
 *
 * Zwei Dinge, die man dazu wissen muss:
 *
 *  - MadMapper hat KEINE festen Adressen fuer einzelne Surfaces. Was ein
 *    Surface steuert, weist man im Programm selbst zu: Regler mit der rechten
 *    Maustaste anklicken, „Copy OSC address" — oder in der App eine Adresse
 *    per „OSC lernen" zuordnen.
 *  - Manche Befehle erwarten gar keinen Wert (in der Liste „nil"): TAP,
 *    Resync, naechstes Medium, Stopp. Diese Bauteile stehen deshalb auf
 *    Nachricht „ohne Wert".
 *
 * Die NovaStar-Seite nutzt die Sonderadressen /nova/... — die Bruecke
 * uebersetzt sie in das TCP-Protokoll des Prozessors (Port 5200).
 */

import { makeWidget, makePage, makeProject, COLORS, placeMissing } from './model.js';

const w = (type, over) => makeWidget(type, over);

/* Kurzformen fuer die wiederkehrenden Faelle der MadMapper-Liste. */
const pegel = (label, address, over) => w('fader', { label, address, min: 0, max: 1, ...over });
const schalter = (label, address, over) => w('toggle', { label, address, argType: 'i', onValue: 1, offValue: 0, ...over });
const befehl = (label, address, over) => w('button', { label, address, argType: 'n', ...over });

/** MadMapper: Summenpegel, Freeze, Tempo, Farbe. */
function mmMaster() {
  const widgets = [
    w('label', { label: 'MadMapper · Master', align: 'left', color: COLORS[8], gx: 0, gy: 0, cw: 12, ch: 1 }),

    pegel('Master', '/master/master_level', { color: COLORS[0], value: 1, gx: 0, gy: 1, cw: 3, ch: 7 }),
    pegel('Video', '/master/master_video_level', { color: COLORS[7], value: 1, gx: 3, gy: 1, cw: 3, ch: 7 }),
    pegel('Audio', '/master/master_audio_level', { color: COLORS[6], value: 1, gx: 6, gy: 1, cw: 3, ch: 7 }),
    pegel('DMX', '/master/master_dmx_level', { color: COLORS[1], value: 1, gx: 9, gy: 1, cw: 3, ch: 7 }),

    schalter('Freeze Video', '/master/freeze_video_output', { color: COLORS[0], gx: 0, gy: 8, cw: 4, ch: 2 }),
    schalter('Freeze Engine', '/master/freeze_engine', { color: COLORS[3], gx: 4, gy: 8, cw: 4, ch: 2 }),
    schalter('Testbild', '/master/test_pattern', { color: COLORS[2], gx: 8, gy: 8, cw: 4, ch: 2 }),

    // Der Bereich des Temporeglers ist eine musikalische Annahme, kein
    // Festwert aus der Liste — im Bauteil aenderbar.
    w('fader', {
      label: 'BPM', address: '/master/Global_BPM/BPM', orient: 'h',
      min: 40, max: 240, value: 120, color: COLORS[2], gx: 0, gy: 10, cw: 8, ch: 2,
    }),
    befehl('TAP', '/master/Global_BPM/TAP', { color: COLORS[2], gx: 8, gy: 10, cw: 4, ch: 2 }),

    w('color', {
      label: 'Master-Farbe', address: '/master/video_color/rgba', colorMode: 'hsv', colorArg: 'rgba32',
      color: COLORS[5], gx: 0, gy: 12, cw: 12, ch: 6,
    }),
  ];
  return makePage('MM Master', { columns: 12, widgets, fit: false });
}

/** MadMapper: Zeitleisten-Bank 1 — Spalten, Cues, Conductor. */
function mmCues() {
  const spalten = Array.from({ length: 16 }, (_, i) => ({
    label: String(i + 1), address: `/timelines/Bank-1/columns/${i + 1}`, value: 0,
  }));
  const zeilen = Array.from({ length: 8 }, (_, i) => ({
    label: `Z${i + 1}`, address: `/timelines/Bank-1/by_cell/col_current/cue_row_${i + 1}/play`, value: 0,
  }));
  const widgets = [
    w('label', { label: 'MadMapper · Bank 1', align: 'left', color: COLORS[8], gx: 0, gy: 0, cw: 12, ch: 1 }),

    w('bank', {
      label: 'Spalten', address: '/timelines/Bank-1/columns', color: COLORS[1],
      bankMode: 'momentary', argType: 'i', onValue: 1, offValue: 0, cols: 4,
      gx: 0, gy: 1, cw: 12, ch: 6, items: spalten,
    }),

    schalter('Play', '/timelines/Bank-1/conductor/play', { color: COLORS[1], gx: 0, gy: 7, cw: 3, ch: 2 }),
    schalter('Pause', '/timelines/Bank-1/conductor/pause', { color: COLORS[2], gx: 3, gy: 7, cw: 3, ch: 2 }),
    befehl('Stopp', '/timelines/Bank-1/conductor/stop', { color: COLORS[4], gx: 6, gy: 7, cw: 3, ch: 2 }),
    befehl('Von vorn', '/timelines/Bank-1/conductor/play_from_beginning', { color: COLORS[6], gx: 9, gy: 7, cw: 3, ch: 2 }),

    pegel('Position', '/timelines/Bank-1/conductor/position', {
      orient: 'h', color: COLORS[7], gx: 0, gy: 9, cw: 12, ch: 2,
    }),

    w('bank', {
      label: 'Cues der aktuellen Spalte', address: '/timelines/Bank-1/by_cell/col_current', color: COLORS[5],
      bankMode: 'momentary', argType: 'i', onValue: 1, offValue: 0, cols: 4,
      gx: 0, gy: 11, cw: 12, ch: 4, items: zeilen,
    }),

    befehl('◀ Spalte', '/timelines/Bank-1/columns/start_previous', { color: COLORS[8], gx: 0, gy: 15, cw: 6, ch: 2 }),
    befehl('Spalte ▶', '/timelines/Bank-1/columns/start_next', { color: COLORS[8], gx: 6, gy: 15, cw: 6, ch: 2 }),
  ];
  return makePage('MM Cues', { columns: 12, widgets, fit: false });
}

/** MadMapper: Medien waehlen, Ausgaenge schalten. */
function mmMedien() {
  const widgets = [
    w('label', { label: 'MadMapper · Medien & Ausgaenge', align: 'left', color: COLORS[8], gx: 0, gy: 0, cw: 12, ch: 1 }),

    befehl('◀ Medium', '/media/previous', { color: COLORS[6], gx: 0, gy: 1, cw: 6, ch: 2 }),
    befehl('Medium ▶', '/media/next', { color: COLORS[6], gx: 6, gy: 1, cw: 6, ch: 2 }),

    w('select', {
      label: 'Medium waehlen', address: '/media/select', argType: 'i', color: COLORS[0], cols: 4,
      gx: 0, gy: 3, cw: 12, ch: 4,
      items: Array.from({ length: 8 }, (_, i) => ({ label: String(i + 1), address: '', value: i + 1 })),
    }),

    schalter('Ausgang 1', '/outputs/Video-Output-1/enabled', { color: COLORS[1], gx: 0, gy: 7, cw: 6, ch: 2 }),
    schalter('Testbild A1', '/outputs/Video-Output-1/show_test_pattern', { color: COLORS[2], gx: 6, gy: 7, cw: 6, ch: 2 }),
    schalter('Ausgang 2', '/outputs/Video-Output-2/enabled', { color: COLORS[1], gx: 0, gy: 9, cw: 6, ch: 2 }),
    schalter('DMX-Ausgang', '/outputs/DMX-Output-1/enabled', { color: COLORS[3], gx: 6, gy: 9, cw: 6, ch: 2 }),

    schalter('MadMapper Vollbild', '/application/view/fullscreen', { color: COLORS[7], gx: 0, gy: 11, cw: 6, ch: 2 }),
    w('meter', {
      label: 'Master (Rueckmeldung)', address: '/master/master_level', min: 0, max: 1,
      color: COLORS[8], gx: 6, gy: 11, cw: 6, ch: 2,
    }),
  ];
  return makePage('MM Medien', { columns: 12, widgets, fit: false });
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
  { id: 'mm-master', name: 'MM Master', hint: 'Pegel, Freeze, Tempo, Farbe', build: mmMaster },
  { id: 'mm-cues', name: 'MM Cues', hint: 'Zeitleisten-Bank 1: Spalten, Cues, Conductor', build: mmCues },
  { id: 'mm-medien', name: 'MM Medien', hint: 'Medien waehlen, Ausgaenge schalten', build: mmMedien },
  { id: 'novastar', name: 'NovaStar', hint: 'Helligkeit, Blackout, Freeze, Presets', build: novastarPage },
  { id: 'leer', name: 'Leer', hint: 'leeres Raster', build: leerePage },
];

export function buildPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[PRESETS.length - 1];
  const page = p.build();
  placeMissing(page.widgets, page.columns);
  return page;
}

/** Startprojekt beim allerersten Oeffnen. */
export function starterProject() {
  return makeProject('Show', [buildPreset('mm-master'), buildPreset('mm-cues'), buildPreset('novastar')]);
}
