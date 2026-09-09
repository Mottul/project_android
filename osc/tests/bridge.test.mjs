/**
 * Bruecke: Bausteine einzeln und einmal komplett durch (WebSocket -> UDP und
 * zurueck). node --test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs, splitHostPort, readOsc, oscString,
  novaBrightness, novaDisplay, novaPreset, DISPLAY, acceptKey,
} from '../bridge/osc-bridge.mjs';
import { encodeMessage, decodePacket } from '../js/osc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(here, '..', 'bridge', 'osc-bridge.mjs');
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/* ------------------------------------------------------------- Bausteine */

test('Argumente werden gelesen', () => {
  const a = parseArgs(['--port', '9000', '--target', '10.0.0.5:8010', '--nova', '10.0.0.9', '--listen', '9001']);
  assert.equal(a.port, 9000);
  assert.equal(a.target, '10.0.0.5:8010');
  assert.equal(a.listen, 9001);
});

test('Host:Port wird zerlegt, Port faellt auf den Standard zurueck', () => {
  assert.deepEqual(splitHostPort('10.0.0.5:8010', 8000), { host: '10.0.0.5', port: 8010 });
  assert.deepEqual(splitHostPort('10.0.0.9', 5200), { host: '10.0.0.9', port: 5200 });
});

test('WebSocket-Handschlag nach RFC 6455', () => {
  // Beispiel aus der Spezifikation.
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('Bruecke liest genau das, was die App schreibt', () => {
  const buf = Buffer.from(encodeMessage('/nova/brightness', [{ type: 'f', value: 42.5 }]));
  const msg = readOsc(buf);
  assert.equal(msg.address, '/nova/brightness');
  assert.equal(Math.round(msg.args[0] * 10) / 10, 42.5);

  const s = readOsc(Buffer.from(encodeMessage('/state', [{ type: 's', value: 'Multiply' }, { type: 'i', value: 3 }])));
  assert.deepEqual(s.args, ['Multiply', 3]);
});

test('oscString erzeugt ein gueltiges Paket', () => {
  const [m] = decodePacket(new Uint8Array(oscString('/nova/state', 'verbunden')));
  assert.equal(m.address, '/nova/state');
  assert.deepEqual(m.args, ['verbunden']);
});

// Erwartungswerte = exakte Frames des Bitfocus-Companion-Moduls
// (companion-module-novastar-controller, NovaPro UHD Jr), Seriennummer 0.
test('NovaStar-Frames stimmen byteweise mit der erprobten Vorlage ueberein', () => {
  assert.equal(hex(novaBrightness(0)), '55 aa 00 00 fe ff 01 ff ff ff 01 00 01 00 00 02 01 00 00 55 5a');
  assert.equal(hex(novaBrightness(100)), '55 aa 00 00 fe ff 01 ff ff ff 01 00 01 00 00 02 01 00 ff 54 5b');
  assert.equal(hex(novaDisplay(DISPLAY.black)), '55 aa 00 00 fe 00 00 00 00 00 01 00 04 00 00 13 02 00 05 00 72 56');
  assert.equal(hex(novaDisplay(DISPLAY.freeze)), '55 aa 00 00 fe 00 00 00 00 00 01 00 04 00 00 13 02 00 04 00 71 56');
  assert.equal(hex(novaDisplay(DISPLAY.normal)), '55 aa 00 00 fe 00 00 00 00 00 01 00 04 00 00 13 02 00 03 00 70 56');
  assert.equal(hex(novaPreset(1)), '55 aa 00 00 fe 00 00 00 00 00 01 00 00 01 51 13 01 00 00 ba 56');
  assert.equal(hex(novaPreset(3)), '55 aa 00 00 fe 00 00 00 00 00 01 00 00 01 51 13 01 00 02 bc 56');
});

test('Helligkeit wird auf 0..100 begrenzt', () => {
  assert.equal(hex(novaBrightness(-20)), hex(novaBrightness(0)));
  assert.equal(hex(novaBrightness(500)), hex(novaBrightness(100)));
});

/* --------------------------------------------------------- Komplettlauf */

/** Freien TCP-Port besorgen. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function udpSocket(port) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', reject);
    s.bind(port, '127.0.0.1', () => resolve(s));
  });
}

const once = (emitter, event, ms = 4000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Zeit abgelaufen: ${event}`)), ms);
  emitter.once(event, (...a) => { clearTimeout(timer); resolve(a.length > 1 ? a : a[0]); });
});

test('Komplettlauf: WebSocket -> UDP, UDP -> WebSocket, /nova/ bleibt liegen', async (t) => {
  const httpPort = await freePort();
  const oscPort = await freePort();
  const backPort = await freePort();

  const target = await udpSocket(oscPort);          // spielt MadMapper
  const child = spawn(process.execPath, [
    BRIDGE, '--port', String(httpPort),
    '--target', `127.0.0.1:${oscPort}`,
    '--listen', String(backPort),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const stop = () => { try { child.kill('SIGKILL'); } catch { /* egal */ } try { target.close(); } catch { /* egal */ } };
  t.after(stop);

  // Auf den Banner warten.
  let out = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Bruecke startet nicht: ${out}`)), 8000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.includes('Beenden mit')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Bruecke beendet (${code}): ${out}`)); });
  });
  assert.match(out, new RegExp(`127\\.0\\.0\\.1:${oscPort}`));

  // Die App liegt einen Ordner hoeher -> die Bruecke liefert sie aus.
  const page = await fetch(`http://127.0.0.1:${httpPort}/`).then((r) => r.text());
  assert.match(page, /OSC Pad/);

  const ws = new WebSocket(`ws://127.0.0.1:${httpPort}`);
  ws.binaryType = 'arraybuffer';
  const inbox = [];
  ws.addEventListener('message', (ev) => inbox.push(ev.data));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket nicht verbunden')), { once: true });
  });

  // 1) Steuerbefehl: Ziel setzen + Antwort auf ping
  ws.send(JSON.stringify({ t: 'target', host: '127.0.0.1', port: oscPort }));
  ws.send(JSON.stringify({ t: 'ping' }));

  // 2) OSC senden -> muss byteweise als UDP ankommen
  const packet = encodeMessage('/surfaces/1/opacity', [{ type: 'f', value: 0.75 }]);
  ws.send(packet);
  const [datagram] = await once(target, 'message');
  assert.equal(hex(datagram), hex(Buffer.from(packet)), 'UDP-Paket weicht ab');
  const [decoded] = decodePacket(new Uint8Array(datagram));
  assert.equal(decoded.address, '/surfaces/1/opacity');
  assert.equal(Math.round(decoded.args[0] * 100), 75);

  // 3) /nova/... geht NICHT ins UDP (die Bruecke setzt es in TCP um)
  let leaked = false;
  target.on('message', () => { leaked = true; });
  ws.send(encodeMessage('/nova/blackout', [{ type: 'i', value: 1 }]));

  // 4) Feedback: UDP an den Empfangsport -> muss am WebSocket ankommen
  const fb = dgram.createSocket('udp4');
  const feedback = Buffer.from(encodeMessage('/surfaces/1/opacity', [{ type: 'f', value: 0.25 }]));
  const gotBinary = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('kein Feedback am WebSocket')), 4000);
    const check = setInterval(() => {
      const bin = inbox.find((x) => x instanceof ArrayBuffer);
      if (bin) { clearInterval(check); clearTimeout(timer); resolve(bin); }
    }, 20);
  });
  const pump = setInterval(() => fb.send(feedback, backPort, '127.0.0.1'), 120);
  const bin = await gotBinary;
  clearInterval(pump);
  fb.close();
  const [back] = decodePacket(new Uint8Array(bin));
  assert.equal(back.address, '/surfaces/1/opacity');
  assert.equal(Math.round(back.args[0] * 100), 25);

  // pong und hello kamen als Text an
  const texts = inbox.filter((x) => typeof x === 'string').map((x) => JSON.parse(x));
  assert.ok(texts.some((m) => m.t === 'hello'), 'kein hello');
  assert.ok(texts.some((m) => m.t === 'pong'), 'kein pong');
  assert.equal(leaked, false, '/nova/ wurde faelschlich als UDP weitergereicht');

  ws.close();
});
