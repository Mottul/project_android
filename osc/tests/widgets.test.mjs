/** Poti-Geometrie: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knobArcPath, fmt } from '../js/widgets.js';

/** Flags eines Bogens lesen: "... A r r rot large sweep x y". */
function flags(d) {
  const m = d.match(/A [\d.]+ [\d.]+ \d+ (\d) (\d)/);
  assert.ok(m, `kein Bogen in "${d}"`);
  return { large: Number(m[1]), sweep: Number(m[2]) };
}

test('der Bogen bleibt bei kleinen Stellungen leer bzw. klein', () => {
  assert.equal(knobArcPath(0), '');
  assert.equal(flags(knobArcPath(0.25)).large, 0);
});

test('das grosse Bogenstueck beginnt erst ab 180 Grad', () => {
  // 270 Grad Gesamtweg: ab zwei Dritteln ist der Bogen laenger als ein Halbkreis.
  assert.equal(flags(knobArcPath(0.51)).large, 0, 'knapp ueber der Haelfte lief der Bogen frueher falsch herum');
  assert.equal(flags(knobArcPath(0.66)).large, 0);
  assert.equal(flags(knobArcPath(0.67)).large, 1);
  assert.equal(flags(knobArcPath(1)).large, 1);
});

test('der Bogen laeuft immer im Uhrzeigersinn', () => {
  for (const n of [0.1, 0.5, 0.75, 1]) assert.equal(flags(knobArcPath(n)).sweep, 1);
});

test('der Bogen startet immer links unten', () => {
  for (const n of [0.2, 0.9]) assert.match(knobArcPath(n), /^M 23\.1 76\.9 /);
});

test('Stellungen ausserhalb 0..1 werden gekappt', () => {
  assert.equal(knobArcPath(5), knobArcPath(1));
  assert.equal(knobArcPath(-3), '');
});

test('fmt zeigt Ganzzahlen ohne Komma', () => {
  assert.equal(fmt(7), '7');
  assert.equal(fmt(0.5), '0.50');
  assert.equal(fmt(123.456), '123.5');
});
