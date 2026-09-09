#!/usr/bin/env node
/**
 * OSC-Bruecke fuer „OSC Pad".
 * ---------------------------------------------------------------------------
 * Ein Browser kann kein UDP — OSC aber schon. Dieses Programm sitzt dazwischen:
 *
 *   Handy  --WebSocket-->  Bruecke  --UDP-->  MadMapper / Resolume / QLab ...
 *   Handy  <-WebSocket--   Bruecke  <-UDP--   (Feedback)
 *
 * Ausserdem:
 *   - Es liefert die App selbst aus (http://<dieser-rechner>:8090). Damit
 *     laeuft alles ohne Internet, und der Browser blockiert nichts.
 *   - Adressen /nova/... werden in NovaStar-Befehle (TCP 5200) uebersetzt.
 *
 * Ziel, Feedback-Port und NovaStar-Adresse stellt die App ein — die Schalter
 * unten sind nur die Startwerte, bis sich das erste Handy meldet.
 *
 * Ohne Abhaengigkeiten, Node.js ab Version 18.
 *
 *   node osc-bridge.mjs                      Standard: Port 8090
 *   node osc-bridge.mjs --port 9000          anderer Port
 *   node osc-bridge.mjs --target 10.0.0.5:8000   Startwert fuers OSC-Ziel
 *   node osc-bridge.mjs --listen 9000        Feedback-Port
 *   node osc-bridge.mjs --nova 10.0.0.9      NovaStar-Prozessor
 *   node osc-bridge.mjs --dir /pfad/zur/app  App-Ordner von Hand setzen
 */

import http from 'node:http';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const NAME = 'OSC-Bruecke';
const VERSION = '1.0.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ------------------------------------------------------------ Argumente -- */

function parseArgs(argv) {
  const out = { port: 8090, dir: null, target: null, listen: null, nova: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port' || a === '-p') out.port = Number(next()) || out.port;
    else if (a === '--dir' || a === '-d') out.dir = next();
    else if (a === '--target' || a === '-t') out.target = next();
    else if (a === '--listen' || a === '-l') out.listen = Number(next());
    else if (a === '--nova' || a === '-n') out.nova = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SELF = fileURLToPath(import.meta.url);
/** Direkt gestartet (node osc-bridge.mjs) oder nur importiert (Tests)? */
const isMain = process.argv[1] ? path.resolve(process.argv[1]) === SELF : false;

function splitHostPort(s, defPort) {
  if (!s) return null;
  const m = String(s).match(/^\[?([^\]]*?)\]?(?::(\d+))?$/);
  if (!m) return null;
  return { host: m[1] || '127.0.0.1', port: Number(m[2]) || defPort };
}

/* ---------------------------------------------------------- OSC-Lesen ---- */

/** Nur so viel OSC-Decoder, wie fuer die /nova/-Umsetzung noetig ist. */
function readOsc(buf) {
  if (buf.length < 8 || buf[0] !== 0x2f /* '/' */) return null;
  const readStr = (pos) => {
    let end = pos;
    while (end < buf.length && buf[end] !== 0) end += 1;
    return { text: buf.toString('utf8', pos, end), next: end + 1 + ((4 - ((end + 1) % 4)) % 4) };
  };
  try {
    const addr = readStr(0);
    let p = addr.next;
    const args2 = [];
    if (p < buf.length && buf[p] === 0x2c /* ',' */) {
      const tags = readStr(p);
      p = tags.next;
      for (let i = 1; i < tags.text.length; i += 1) {
        const t = tags.text[i];
        if (t === 'i') { args2.push(buf.readInt32BE(p)); p += 4; }
        else if (t === 'f') { args2.push(buf.readFloatBE(p)); p += 4; }
        else if (t === 'd') { args2.push(buf.readDoubleBE(p)); p += 8; }
        else if (t === 's' || t === 'S') { const r = readStr(p); args2.push(r.text); p = r.next; }
        else if (t === 'T') args2.push(1);
        else if (t === 'F') args2.push(0);
        else break;
      }
    }
    return { address: addr.text, args: args2 };
  } catch {
    return null;
  }
}

/** Baut eine OSC-Nachricht mit String-Argument (fuer /nova/state zurueck). */
function oscString(address, text) {
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
  return Buffer.concat([pad(Buffer.from(address, 'utf8')), pad(Buffer.from(',s', 'utf8')), pad(Buffer.from(text, 'utf8'))]);
}

/* -------------------------------------------------------- NovaStar-TCP --- */
// Byte-Folgen aus dem quelloffenen Bitfocus-Companion-Modul fuer den
// NovaPro UHD Jr. Rahmen: [12-Byte-Kopf][Register 4 B LE][Laenge 2 B LE][Daten]
// [Pruefsumme 2 B LE]; Pruefsumme = (Summe ab Offset 2 + 0x5555) & 0xffff.

const HDR_CARDS = [0x55, 0xaa, 0x00, 0x00, 0xfe, 0xff, 0x01, 0xff, 0xff, 0xff, 0x01, 0x00];
const HDR_MAIN = [0x55, 0xaa, 0x00, 0x00, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00];
const REG = { brightness: 0x02000001, displayMode: 0x13000004, preset: 0x13510100 };
const DISPLAY = { normal: 0x03, freeze: 0x04, black: 0x05 };

function novaFrame(header, reg, data) {
  const buf = Buffer.alloc(header.length + 6 + data.length);
  Buffer.from(header).copy(buf, 0);
  buf.writeUInt32LE(reg >>> 0, header.length);
  buf.writeUInt16LE(data.length, header.length + 4);
  if (data.length) Buffer.from(data).copy(buf, header.length + 6);
  let sum = 0;
  for (let i = 2; i < buf.length; i += 1) sum += buf[i];
  const out = Buffer.alloc(buf.length + 2);
  buf.copy(out, 0);
  out.writeUInt16LE((sum + 0x5555) & 0xffff, buf.length);
  return out;
}

const novaBrightness = (pct) => novaFrame(HDR_CARDS, REG.brightness, [Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255)]);
const novaDisplay = (mode) => novaFrame(HDR_MAIN, REG.displayMode, [mode, 0x00]);
const novaPreset = (n) => novaFrame(HDR_MAIN, REG.preset, [Math.max(0, Math.min(255, Math.round(n) - 1))]);

/* ------------------------------------------------------------ Zustand ---- */

const state = {
  target: splitHostPort(args.target, 8000) || { host: '127.0.0.1', port: 8000 },
  listenPort: Number.isFinite(args.listen) ? args.listen : 0,
  nova: splitHostPort(args.nova, 5200) || { host: '', port: 5200 },
  sent: 0,
  recv: 0,
};

const clients = new Set();
const udpOut = dgram.createSocket('udp4');
udpOut.on('error', (err) => log('UDP-Sendefehler:', err.message));
let udpIn = null;

function log(...parts) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...parts);
}

function broadcast(data) {
  for (const c of clients) c.send(data);
}

function bindFeedback(port) {
  if (udpIn) { try { udpIn.close(); } catch { /* egal */ } udpIn = null; }
  state.listenPort = Number(port) || 0;
  if (!state.listenPort) return;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', (err) => {
    log(`Feedback-Port ${state.listenPort} nicht nutzbar:`, err.message);
    for (const c of clients) c.sendJson({ t: 'status', error: `Feedback-Port ${state.listenPort}: ${err.message}`, targetOk: true });
    try { sock.close(); } catch { /* egal */ }
    if (udpIn === sock) udpIn = null;
  });
  sock.on('message', (msg) => { state.recv += 1; broadcast(msg); });
  sock.bind(state.listenPort, () => log(`Feedback laeuft auf UDP ${state.listenPort}`));
  udpIn = sock;
}

/* -------------------------------------------------------- NovaStar-Link -- */

let novaSock = null;
let novaBusy = false;

function novaSend(packet) {
  if (!state.nova.host) return 'kein NovaStar-Host eingetragen';
  if (novaSock && !novaSock.destroyed && novaSock.writable) {
    novaSock.write(packet);
    return '';
  }
  if (novaBusy) return 'verbinde …';
  novaBusy = true;
  const sock = net.createConnection({ host: state.nova.host, port: state.nova.port }, () => {
    novaBusy = false;
    log(`NovaStar verbunden: ${state.nova.host}:${state.nova.port}`);
    sock.write(packet);
    broadcast(oscString('/nova/state', 'verbunden'));
  });
  sock.setNoDelay(true);
  sock.on('error', (err) => {
    novaBusy = false;
    log('NovaStar-Fehler:', err.message);
    broadcast(oscString('/nova/state', err.message));
    sock.destroy();
    if (novaSock === sock) novaSock = null;
  });
  sock.on('close', () => { if (novaSock === sock) novaSock = null; });
  novaSock = sock;
  return '';
}

/** /nova/... -> NovaStar. Gibt true zurueck, wenn die Nachricht behandelt wurde. */
function handleNova(msg) {
  if (!msg || !msg.address.startsWith('/nova/')) return false;
  const v = Number(msg.args[0] ?? 0);
  switch (msg.address) {
    case '/nova/brightness': novaSend(novaBrightness(v)); break;
    case '/nova/blackout': novaSend(novaDisplay(v >= 0.5 ? DISPLAY.black : DISPLAY.normal)); break;
    case '/nova/freeze': novaSend(novaDisplay(v >= 0.5 ? DISPLAY.freeze : DISPLAY.normal)); break;
    case '/nova/normal': novaSend(novaDisplay(DISPLAY.normal)); break;
    case '/nova/preset': novaSend(novaPreset(v)); break;
    default: return false;
  }
  return true;
}

/* --------------------------------------------------------- WebSocket ----- */

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

/** Minimaler WebSocket-Server (RFC 6455), nur was gebraucht wird. */
function makeClient(socket) {
  let buf = Buffer.alloc(0);
  let frags = [];
  let fragOp = 0;

  const client = {
    socket,
    send(data) {
      if (socket.destroyed) return;
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      socket.write(frame(Buffer.isBuffer(data) ? 0x2 : 0x1, payload));
    },
    sendJson(obj) { client.send(JSON.stringify(obj)); },
    close() { try { socket.end(frame(0x8, Buffer.alloc(0))); } catch { /* egal */ } },
  };

  function frame(opcode, payload) {
    let head;
    const len = payload.length;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | opcode;
    return Buffer.concat([head, payload]);
  }

  socket.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let p = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); p = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); p = 10; }
      if (len > 4 * 1024 * 1024) { client.close(); return; }
      const maskKey = masked ? buf.subarray(p, p + 4) : null;
      if (masked) p += 4;
      if (buf.length < p + len) return;
      const payload = Buffer.from(buf.subarray(p, p + len));
      if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i & 3];
      buf = buf.subarray(p + len);

      if (opcode === 0x8) { client.close(); return; }
      if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x0) { frags.push(payload); }
      else { frags = [payload]; fragOp = opcode; }
      if (!fin) continue;
      const message = frags.length === 1 ? frags[0] : Buffer.concat(frags);
      frags = [];
      onMessage(client, fragOp, message);
    }
  });

  const drop = () => { clients.delete(client); };
  socket.on('close', drop);
  socket.on('error', drop);
  socket.setNoDelay(true);
  clients.add(client);
  client.sendJson({ t: 'hello', name: NAME, version: VERSION });
  client.sendJson({ t: 'status', targetOk: true, target: state.target, listen: state.listenPort });
  log(`Handy verbunden (${clients.size} aktiv)`);
  return client;
}

function onMessage(client, opcode, data) {
  // Text = Steuerbefehl, Binaer = fertiges OSC-Paket.
  if (opcode === 0x1) {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (msg.t === 'ping') { client.sendJson({ t: 'pong' }); return; }
    if (msg.t === 'target') {
      state.target = { host: String(msg.host || '127.0.0.1'), port: Number(msg.port) || 8000 };
      log(`Ziel: ${state.target.host}:${state.target.port}`);
      client.sendJson({ t: 'status', targetOk: true, target: state.target });
      return;
    }
    if (msg.t === 'listen') {
      const port = Number(msg.port) || 0;
      if (port !== state.listenPort) bindFeedback(port);
      return;
    }
    if (msg.t === 'nova') {
      const host = String(msg.host || '');
      const port = Number(msg.port) || 5200;
      if (host !== state.nova.host || port !== state.nova.port) {
        state.nova = { host, port };
        if (novaSock) { try { novaSock.destroy(); } catch { /* egal */ } novaSock = null; }
        if (host) log(`NovaStar-Ziel: ${host}:${port}`);
      }
      return;
    }
    return;
  }

  if (opcode !== 0x2) return;
  const parsed = readOsc(data);
  if (parsed && parsed.address.startsWith('/nova/')) {
    if (handleNova(parsed)) return;
  }
  udpOut.send(data, state.target.port, state.target.host, (err) => {
    if (err) {
      log('senden fehlgeschlagen:', err.message);
      client.sendJson({ t: 'status', targetOk: false, error: err.message });
    } else {
      state.sent += 1;
    }
  });
}

/* ------------------------------------------------------ HTTP + Ausliefern */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const here = path.dirname(fileURLToPath(import.meta.url));
function findAppDir() {
  const candidates = [args.dir, here, path.join(here, '..'), path.join(here, 'app')].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'index.html'))) return path.resolve(c);
    } catch { /* egal */ }
  }
  return null;
}
const appDir = findAppDir();

const FALLBACK = `<!doctype html><meta charset="utf-8"><title>${NAME}</title>
<body style="font:16px system-ui;background:#0b0e13;color:#e9eef5;padding:32px;line-height:1.5">
<h1>${NAME} ${VERSION}</h1>
<p>Die Bruecke laeuft. Die App liegt nicht neben dieser Datei — oeffne sie im Browser
und trage dort als Bruecke <code id="u"></code> ein.</p>
<script>document.getElementById('u').textContent='ws://'+location.host;</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ name: NAME, version: VERSION, clients: clients.size, ...state }));
    return;
  }
  if (!appDir) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FALLBACK);
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(appDir, `.${rel}`);
  if (!file.startsWith(appDir)) { res.writeHead(403).end('verboten'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  const client = makeClient(socket);
  if (head && head.length) socket.emit('data', head);
});

/* ----------------------------------------------------------------- Start */

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function start() {
if (state.listenPort) bindFeedback(state.listenPort);

server.listen(args.port, () => {
  const lines = [
    '',
    `  ${NAME} ${VERSION}`,
    '  ' + '─'.repeat(46),
    `  OSC-Ziel      ${state.target.host}:${state.target.port}`,
    `  Feedback      ${state.listenPort ? `UDP ${state.listenPort}` : 'aus'}`,
    `  NovaStar      ${state.nova.host ? `${state.nova.host}:${state.nova.port}` : 'aus'}`,
    `  App-Ordner    ${appDir || '— (nur Bruecke)'}`,
    '',
    '  Am Handy oeffnen:',
    ...(addresses().length ? addresses().map((ip) => `    http://${ip}:${args.port}`) : ['    (keine Netzwerkadresse gefunden)']),
    `    http://localhost:${args.port}   (auf diesem Rechner)`,
    '',
    '  Beenden mit Strg+C',
    '',
  ];
  console.log(lines.join('\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\n  Port ${args.port} ist belegt. Mit --port 8091 einen anderen waehlen.\n`);
  else console.error('\n  Fehler:', err.message, '\n');
  process.exit(1);
});

process.on('SIGINT', () => { console.log('\n  beendet.'); process.exit(0); });
}

if (isMain) {
  if (args.help) {
    const doc = fs.readFileSync(SELF, 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, '').replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, '');
    console.log(doc);
    process.exit(0);
  }
  start();
}

// Fuer die Tests: die reinen Bausteine sind auch einzeln nutzbar.
export { parseArgs, splitHostPort, readOsc, oscString, novaFrame, novaBrightness, novaDisplay, novaPreset, DISPLAY, acceptKey, start };
