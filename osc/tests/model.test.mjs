/** Raster und Datenmodell: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWidget, makePage, normalizeProject, normalizeWidget, overlaps, fits, findSlot,
  placeMissing, autoArrange, compact, usedRows, recolumn, minSize, dropAt, DEFAULT_COLS,
  bumpNumber, nextFreeAddress, copyWidget, placeCopy, addressesOf,
  BASE_COLORS, COLOR_MODES, defaultPalette, hsv2rgb, rgb2hsv,
} from '../js/model.js';
import { buildPreset, starterProject, PRESETS } from '../js/presets.js';

const rect = (gx, gy, cw, ch, id = 'x') => ({ id, gx, gy, cw, ch });

test('overlaps erkennt Beruehrung und Ueberschneidung richtig', () => {
  assert.ok(overlaps(rect(0, 0, 2, 2), rect(1, 1, 2, 2)));
  assert.ok(!overlaps(rect(0, 0, 2, 2), rect(2, 0, 2, 2)), 'Kante an Kante ist keine Ueberschneidung');
  assert.ok(!overlaps(rect(0, 0, 2, 2), rect(0, 2, 2, 2)));
});

test('fits achtet auf Rand und Nachbarn', () => {
  const others = [rect(0, 0, 4, 2, 'a')];
  assert.ok(!fits(rect(2, 0, 4, 2, 'b'), others, 12));
  assert.ok(fits(rect(4, 0, 4, 2, 'b'), others, 12));
  assert.ok(!fits(rect(10, 0, 4, 2, 'b'), others, 12), 'ragt aus dem Raster');
  assert.ok(fits(rect(0, 0, 4, 2, 'a'), others, 12, 'a'), 'sich selbst ignorieren');
});

test('findSlot fuellt Luecken von links oben', () => {
  const placed = [rect(0, 0, 6, 2, 'a'), rect(6, 0, 6, 2, 'b')];
  assert.deepEqual(findSlot(placed, 12, 6, 2), { gx: 0, gy: 2 });
  assert.deepEqual(findSlot([rect(0, 0, 6, 2, 'a')], 12, 6, 2), { gx: 6, gy: 0 });
});

test('placeMissing platziert alles ueberschneidungsfrei', () => {
  const list = Array.from({ length: 12 }, () => makeWidget('fader'));
  placeMissing(list, 12);
  for (const w of list) assert.ok(w.gx >= 0 && w.gy >= 0);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      assert.ok(!overlaps(list[i], list[j]), `${i} und ${j} ueberlappen`);
    }
  }
});

test('autoArrange packt dicht und ohne Ueberschneidung', () => {
  const list = [
    makeWidget('fader', { gx: 0, gy: 9, cw: 3, ch: 6 }),
    makeWidget('toggle', { gx: 4, gy: 20, cw: 4, ch: 2 }),
    makeWidget('button', { gx: 8, gy: 30, cw: 4, ch: 2 }),
  ];
  autoArrange(list, 12);
  assert.equal(Math.min(...list.map((w) => w.gy)), 0);
  assert.ok(usedRows(list) <= 6 + 2);
});

test('compact zieht alles nach oben, ohne zu ueberlappen', () => {
  const list = [makeWidget('toggle', { gx: 0, gy: 0, cw: 4, ch: 2 }), makeWidget('toggle', { gx: 0, gy: 7, cw: 4, ch: 2 })];
  compact(list, 12);
  assert.equal(list[1].gy, 2);
});

test('recolumn haelt alles im neuen Raster', () => {
  const page = makePage('t', { columns: 12, widgets: [
    makeWidget('fader', { gx: 0, gy: 0, cw: 3, ch: 6 }),
    makeWidget('fader', { gx: 9, gy: 0, cw: 3, ch: 6 }),
  ] });
  recolumn(page, 6);
  assert.equal(page.columns, 6);
  for (const w of page.widgets) {
    assert.ok(w.gx >= 0 && w.gx + w.cw <= 6, `${w.gx}+${w.cw}`);
    assert.ok(w.cw >= minSize(w.type).cw);
  }
  assert.ok(!overlaps(page.widgets[0], page.widgets[1]));
});

test('dropAt setzt die Kachel genau dorthin und schiebt andere weg', () => {
  const a = makeWidget('fader', { gx: 0, gy: 0, cw: 4, ch: 8 });
  const b = makeWidget('fader', { gx: 4, gy: 0, cw: 4, ch: 8 });
  const c = makeWidget('fader', { gx: 8, gy: 0, cw: 4, ch: 8 });
  const list = [a, b, c];
  // a mitten auf b legen — auf einer vollen Seite muss das trotzdem gehen
  dropAt(list, 12, a, { gx: 4, gy: 0, cw: 4, ch: 8 });
  assert.equal(a.gx, 4);
  assert.equal(a.gy, 0);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      assert.ok(!overlaps(list[i], list[j]), 'nach dropAt ueberlappt nichts');
    }
  }
  assert.ok(b.gy > 0, 'die verdraengte Kachel ist nach unten gewandert');
});

test('dropAt haelt die Kachel im Raster', () => {
  const a = makeWidget('fader', { gx: 0, gy: 0, cw: 4, ch: 6 });
  dropAt([a], 12, a, { gx: 20, gy: -3, cw: 4, ch: 6 });
  assert.equal(a.gx, 8);
  assert.equal(a.gy, 0);
});

test('normalizeWidget repariert kaputte Werte', () => {
  const w = normalizeWidget({ type: 'unsinn', color: 'blau', min: 'x', max: 'x', value: 99, cw: 0, items: 'nein' });
  assert.equal(w.type, 'fader');
  assert.match(w.color, /^#[0-9a-f]{6}$/);
  assert.equal(w.min, 0);
  assert.equal(w.max, 1);
  assert.ok(w.value <= 1);
  assert.ok(w.cw >= minSize('fader').cw);
  assert.deepEqual(w.items, []);
});

test('normalizeProject liefert immer eine benutzbare Struktur', () => {
  const p = normalizeProject(null);
  assert.ok(p.pages.length >= 1);
  assert.ok(p.pages.some((x) => x.id === p.currentPageId));
  const p2 = normalizeProject({ pages: [{ widgets: [{ type: 'fader' }] }], currentPageId: 'gibtsnicht' });
  assert.equal(p2.currentPageId, p2.pages[0].id);
});

test('alle Vorlagen sind ueberschneidungsfrei und passen ins Raster', () => {
  for (const preset of PRESETS) {
    const page = buildPreset(preset.id);
    for (const w of page.widgets) {
      assert.ok(w.gx >= 0 && w.gx + w.cw <= page.columns, `${preset.id}: ${w.label} ragt heraus`);
      assert.ok(w.ch >= minSize(w.type).ch, `${preset.id}: ${w.label} zu flach`);
    }
    for (let i = 0; i < page.widgets.length; i += 1) {
      for (let j = i + 1; j < page.widgets.length; j += 1) {
        assert.ok(!overlaps(page.widgets[i], page.widgets[j]),
          `${preset.id}: ${page.widgets[i].label} und ${page.widgets[j].label} ueberlappen`);
      }
    }
  }
});

test('Startprojekt hat MadMapper- und NovaStar-Seite', () => {
  const p = starterProject();
  assert.deepEqual(p.pages.map((x) => x.name), ['MadMapper', 'NovaStar']);
  assert.equal(p.currentPageId, p.pages[0].id);
});

test('Standardraster ist zwoelfspaltig', () => {
  assert.equal(DEFAULT_COLS, 12);
  assert.equal(makePage().columns, 12);
});

/* ----------------------------------------------------------- Duplizieren --- */

test('bumpNumber zaehlt die letzte Zahl hoch', () => {
  assert.equal(bumpNumber('Surface 1'), 'Surface 2');
  assert.equal(bumpNumber('/cues/9/recall'), '/cues/10/recall');
  assert.equal(bumpNumber('/nova/preset/01'), '/nova/preset/02', 'fuehrende Null bleibt');
  assert.equal(bumpNumber('Master'), 'Master 2', 'ohne Zahl haengt der Zusatz an');
  assert.equal(bumpNumber('/master/opacity', '2'), '/master/opacity2');
  assert.equal(bumpNumber(''), '');
});

test('nextFreeAddress weicht belegten Adressen aus', () => {
  const taken = new Set(['/s/2/opacity', '/s/3/opacity']);
  assert.equal(nextFreeAddress('/s/1/opacity', taken), '/s/4/opacity');
  assert.equal(nextFreeAddress('', taken), '');
});

test('copyWidget zaehlt Beschriftung und Adressen hoch', () => {
  const a = makeWidget('fader', { label: 'Surface 1', address: '/surfaces/1/opacity' });
  const b = makeWidget('fader', { label: 'Surface 2', address: '/surfaces/2/opacity' });
  const copy = copyWidget(a, [a, b]);
  assert.notEqual(copy.id, a.id);
  assert.equal(copy.label, 'Surface 2');
  assert.equal(copy.address, '/surfaces/3/opacity', 'belegte Adresse wird uebersprungen');
  assert.equal(a.address, '/surfaces/1/opacity', 'die Vorlage bleibt unberuehrt');
});

test('copyWidget zaehlt auch Y-Adresse und Eintraege hoch', () => {
  const xy = makeWidget('xy', { address: '/pos/1/x', addressY: '/pos/1/y' });
  const bank = makeWidget('bank', {
    items: [{ label: '1', address: '/cues/1/recall', value: 0 }, { label: '2', address: '/cues/2/recall', value: 0 }],
  });
  const c1 = copyWidget(xy, [xy]);
  assert.equal(c1.address, '/pos/2/x');
  assert.equal(c1.addressY, '/pos/2/y');
  const c2 = copyWidget(bank, [bank]);
  assert.deepEqual(c2.items.map((i) => i.address), ['/cues/3/recall', '/cues/4/recall']);
  assert.equal(new Set(c2.items.map((i) => i.address)).size, 2, 'keine doppelten Adressen');
});

test('addressesOf sammelt alle belegten Adressen', () => {
  const w = makeWidget('bank', { address: '/a', items: [{ label: '', address: '/b', value: 0 }] });
  const set = addressesOf([w]);
  assert.ok(set.has('/a') && set.has('/b'));
});

test('placeCopy legt die Kopie neben das Original', () => {
  const a = makeWidget('fader', { gx: 0, gy: 0, cw: 3, ch: 6 });
  const list = [a];
  const copy = copyWidget(a, list);
  list.push(copy);
  placeCopy(list, 12, copy, a);
  assert.deepEqual({ gx: copy.gx, gy: copy.gy }, { gx: 3, gy: 0 });
  assert.ok(!overlaps(a, copy));
});

test('placeCopy weicht aus, wenn daneben und darunter belegt ist', () => {
  const a = makeWidget('fader', { gx: 0, gy: 0, cw: 6, ch: 6 });
  const b = makeWidget('fader', { gx: 6, gy: 0, cw: 6, ch: 6 });
  const c = makeWidget('fader', { gx: 0, gy: 6, cw: 12, ch: 6 });
  const list = [a, b, c];
  const copy = copyWidget(a, list);
  list.push(copy);
  placeCopy(list, 12, copy, a);
  for (const other of [a, b, c]) assert.ok(!overlaps(copy, other), 'die Kopie liegt frei');
});

test('Mindestgroessen erlauben kleine Kacheln', () => {
  assert.deepEqual(minSize('toggle'), { cw: 1, ch: 1 });
  assert.ok(minSize('knob').cw <= 2 && minSize('knob').ch <= 2);
  const w = normalizeWidget({ type: 'toggle', cw: 1, ch: 1 });
  assert.deepEqual({ cw: w.cw, ch: w.ch }, { cw: 1, ch: 1 });
});

test('die Bank kennt den Poti-Modus', () => {
  assert.equal(normalizeWidget({ type: 'bank', bankMode: 'knob' }).bankMode, 'knob');
  assert.equal(normalizeWidget({ type: 'bank', bankMode: 'quatsch' }).bankMode, 'momentary');
});

/* ----------------------------------------------------------------- Farbe --- */

test('das Farb-Bauteil kennt drei Bedienarten', () => {
  assert.deepEqual(COLOR_MODES, ['rgb', 'hsv', 'palette']);
  assert.equal(makeWidget('color').colorMode, 'rgb', 'alte Seiten bleiben, wie sie waren');
  for (const mode of COLOR_MODES) {
    assert.equal(normalizeWidget({ type: 'color', colorMode: mode }).colorMode, mode);
  }
  assert.equal(normalizeWidget({ type: 'color', colorMode: 'quatsch' }).colorMode, 'rgb');
  // Die Namen der ersten Fassung zeigen auf dasselbe.
  assert.equal(normalizeWidget({ type: 'color', colorMode: 'basic' }).colorMode, 'palette');
  assert.equal(normalizeWidget({ type: 'color', colorMode: 'picker' }).colorMode, 'hsv');
});

test('HSV und RGB rechnen sauber hin und her', () => {
  const proben = [[0, 1, 1], [120, 1, 1], [210, 0.8, 0.9], [45, 0.5, 0.25], [0, 0, 1], [0, 0, 0]];
  for (const [h, s2, v] of proben) {
    const { r, g, b } = hsv2rgb(h, s2, v);
    for (const c of [r, g, b]) assert.ok(c >= 0 && c <= 1, `Kanal ausserhalb 0..1 bei ${h}/${s2}/${v}`);
    const back = rgb2hsv(r, g, b);
    assert.ok(Math.abs(back.v - v) < 1e-9, `v bei ${h}/${s2}/${v}`);
    assert.ok(Math.abs(back.s - s2) < 1e-9, `s bei ${h}/${s2}/${v}`);
    if (s2 > 0 && v > 0) assert.ok(Math.abs(back.h - h) < 1e-6, `h bei ${h}/${s2}/${v}`);
  }
});

test('die eigene Palette wird geprueft und begrenzt', () => {
  const w = normalizeWidget({ type: 'color', palette: ['#ff0000', 'blau', '#00FF00'] });
  assert.deepEqual(w.palette, ['#ff0000', '#ffffff', '#00ff00'], 'Unsinn wird zu Weiss');
  assert.deepEqual(normalizeWidget({ type: 'color' }).palette, [], 'leer = Grundfarben');
  assert.ok(defaultPalette().length >= 12);
});

test('die Grundfarben sind saubere Hex-Werte und eindeutig', () => {
  assert.ok(BASE_COLORS.length >= 12);
  const seen = new Set();
  for (const [name, hex] of BASE_COLORS) {
    assert.ok(name && typeof name === 'string', 'jede Farbe hat einen Namen');
    assert.match(hex, /^#[0-9a-f]{6}$/, `${name}: ${hex}`);
    assert.ok(!seen.has(hex), `${hex} kommt doppelt vor`);
    seen.add(hex);
  }
});

/* ------------------------------------------------------------- Spalten --- */

test('recolumn laesst die Groessen stehen', () => {
  const page = makePage('t', { columns: 12, widgets: [
    makeWidget('fader', { label: 'A', gx: 0, gy: 0, cw: 3, ch: 6 }),
    makeWidget('toggle', { label: 'B', gx: 3, gy: 0, cw: 6, ch: 2 }),
  ] });
  recolumn(page, 11);
  assert.deepEqual(page.widgets.map((w) => w.cw), [3, 6], 'nichts wird hochgerechnet');
  recolumn(page, 12);
  assert.deepEqual(page.widgets.map((w) => w.cw), [3, 6]);
  assert.deepEqual(page.widgets.map((w) => w.gx), [0, 3], 'und nichts wandert');
});

test('Spalten hin und zurueck laesst den Aufbau heil', () => {
  const page = buildPreset('madmapper');
  const vorher = page.widgets.map((w) => `${w.label}:${w.gx},${w.gy} ${w.cw}x${w.ch}`).join('|');
  for (const c of [11, 10, 9, 8, 7, 6, 7, 8, 9, 10, 11, 12]) recolumn(page, c);
  const breiten = page.widgets.map((w) => w.cw);
  assert.ok(breiten.every((cw) => cw <= 12), 'keine Kachel waechst ueber das Raster');
  const master = page.widgets.find((w) => w.label === 'Master');
  assert.equal(master.cw, 3, 'ein drei Spalten breiter Fader bleibt drei Spalten breit');
  for (let i = 0; i < page.widgets.length; i += 1) {
    for (let j = i + 1; j < page.widgets.length; j += 1) {
      assert.ok(!overlaps(page.widgets[i], page.widgets[j]), 'nichts ueberlappt');
    }
    assert.ok(page.widgets[i].gx + page.widgets[i].cw <= 12, 'nichts ragt heraus');
  }
  assert.ok(vorher.length > 0);
});

test('beim Spaltenwechsel waechst nie eine Kachel von selbst', () => {
  const page = buildPreset('madmapper');
  const vorher = new Map(page.widgets.map((w) => [w.label, w.cw]));
  for (const c of [11, 12, 11, 12, 4, 12]) {
    recolumn(page, c);
    for (const w of page.widgets) {
      assert.ok(w.cw <= vorher.get(w.label), `${w.label} ist bei ${c} Spalten breiter geworden`);
    }
  }
});

test('was in beide Raster passt, bleibt beim Wechsel unberuehrt', () => {
  const page = makePage('t', { columns: 12, widgets: [
    makeWidget('fader', { label: 'A', gx: 0, gy: 0, cw: 3, ch: 6 }),
    makeWidget('fader', { label: 'B', gx: 3, gy: 0, cw: 3, ch: 6 }),
  ] });
  recolumn(page, 11);
  recolumn(page, 12);
  assert.deepEqual(page.widgets.map((w) => `${w.gx},${w.gy} ${w.cw}x${w.ch}`), ['0,0 3x6', '3,0 3x6']);
});

test('beim Verkleinern behaelt die volle Breite die volle Breite', () => {
  const page = makePage('t', { columns: 12, widgets: [makeWidget('label', { gx: 0, gy: 0, cw: 12, ch: 1 })] });
  recolumn(page, 8);
  assert.equal(page.widgets[0].cw, 8, 'die Ueberschrift laesst keinen Rest stehen');
  recolumn(page, 4);
  assert.equal(page.widgets[0].cw, 4);
});
