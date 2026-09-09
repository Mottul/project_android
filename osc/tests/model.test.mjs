/** Raster und Datenmodell: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWidget, makePage, normalizeProject, normalizeWidget, overlaps, fits, findSlot,
  placeMissing, autoArrange, compact, usedRows, rescale, minSize, dropAt, DEFAULT_COLS,
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

test('rescale haelt alles im neuen Raster', () => {
  const page = makePage('t', { columns: 12, widgets: [
    makeWidget('fader', { gx: 0, gy: 0, cw: 3, ch: 6 }),
    makeWidget('fader', { gx: 9, gy: 0, cw: 3, ch: 6 }),
  ] });
  rescale(page, 6);
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
