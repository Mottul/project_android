/** OSC-Codec: node --test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodePacket, align4, isValidAddress, formatMessage } from '../js/osc.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

test('align4 rundet auf 4-Byte-Grenzen auf', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(align4), [0, 4, 4, 4, 4, 8]);
});

test('Nachricht ohne Argumente ist Adresse + leere Typenliste', () => {
  const buf = encodeMessage('/x');
  assert.equal(hex(buf), '2f 78 00 00 2c 00 00 00');
  assert.equal(buf.byteLength % 4, 0);
});

test('float, int, string und Wahrheitswerte werden bitgenau kodiert', () => {
  const buf = encodeMessage('/a/b', [
    { type: 'f', value: 0.5 }, { type: 'i', value: 7 },
    { type: 's', value: 'hi' }, { type: 'T' },
  ]);
  assert.equal(hex(buf), '2f 61 2f 62 00 00 00 00 2c 66 69 73 54 00 00 00 3f 00 00 00 00 00 00 07 68 69 00 00');
});

test('Adresse ohne fuehrenden Schraegstrich wird ergaenzt', () => {
  const [m] = decodePacket(encodeMessage('cue/1', []));
  assert.equal(m.address, '/cue/1');
});

test('Hin und zurueck: Werte bleiben erhalten', () => {
  const args = [{ type: 'i', value: -42 }, { type: 'f', value: 0.25 }, { type: 's', value: 'Ümläut' }, { type: 'F' }];
  const [m] = decodePacket(encodeMessage('/mix/1', args));
  assert.equal(m.address, '/mix/1');
  assert.deepEqual(m.args, [-42, 0.25, 'Ümläut', false]);
  assert.equal(m.types, 'ifsF');
});

test('jede Nachrichtenlaenge ist durch 4 teilbar', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'abcde']) {
    const buf = encodeMessage(`/${s}`, [{ type: 's', value: s }]);
    assert.equal(buf.byteLength % 4, 0, `Laenge fuer "${s}"`);
  }
});

test('Bundles werden zu einzelnen Nachrichten aufgeloest', () => {
  const a = new Uint8Array(encodeMessage('/one', [{ type: 'i', value: 1 }]));
  const b = new Uint8Array(encodeMessage('/two', [{ type: 'i', value: 2 }]));
  const head = new TextEncoder().encode('#bundle\0');
  const total = 8 + 8 + 4 + a.length + 4 + b.length;
  const u8 = new Uint8Array(total);
  u8.set(head, 0);
  const dv = new DataView(u8.buffer);
  let p = 16;
  dv.setInt32(p, a.length, false); p += 4; u8.set(a, p); p += a.length;
  dv.setInt32(p, b.length, false); p += 4; u8.set(b, p);
  const msgs = decodePacket(u8);
  assert.deepEqual(msgs.map((m) => m.address), ['/one', '/two']);
  assert.deepEqual(msgs.map((m) => m.args[0]), [1, 2]);
});

test('abgeschnittene Pakete werfen nicht', () => {
  const full = new Uint8Array(encodeMessage('/a', [{ type: 'f', value: 1 }]));
  for (let n = 0; n < full.length; n += 1) {
    assert.doesNotThrow(() => decodePacket(full.subarray(0, n)));
  }
});

test('unbekannter Sendetyp wird gemeldet', () => {
  assert.throws(() => encodeMessage('/a', [{ type: 'q', value: 1 }]), TypeError);
});

test('Adressen werden grob geprueft', () => {
  assert.ok(isValidAddress('/surfaces/1/opacity'));
  assert.ok(!isValidAddress('surfaces'));
  assert.ok(!isValidAddress('/mit leerzeichen'));
  assert.ok(!isValidAddress('/'));
});

test('formatMessage ist kurz und lesbar', () => {
  assert.equal(formatMessage('/a', [1, 0.5, 'x']), '/a 1 0.5 "x"');
  assert.equal(formatMessage('/a', []), '/a');
});
