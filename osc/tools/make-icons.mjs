/**
 * Erzeugt die PWA-Icons als PNG — ohne externe Abhaengigkeiten.
 * Aufruf: npm run icons:osc (aus dem Repo-Wurzelverzeichnis)
 *
 * Motiv: drei Fader auf dunklem Grund — auf dem Startbildschirm sofort als
 * Steuerpult erkennbar, auch bei 48 px.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const out = (name) => new URL(`../icons/${name}`, import.meta.url);

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // Bittiefe
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function icon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = hex('#0b0e13');
  const trackCol = hex('#1c2430');
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.24 : size * 0.19;

  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const inv = 1 - a / 255;
    buf[i] = Math.round(r * (a / 255) + buf[i] * inv);
    buf[i + 1] = Math.round(g * (a / 255) + buf[i + 1] * inv);
    buf[i + 2] = Math.round(b * (a / 255) + buf[i + 2] * inv);
    buf[i + 3] = Math.max(buf[i + 3], a);
  };

  const board = size - inset * 2;
  const gap = board * 0.16;
  const w = (board - gap * 2) / 3;
  // Fuellstaende und Farben der drei Fader.
  const lanes = [
    { fill: 0.72, color: '#38bdf8' },
    { fill: 0.42, color: '#22c55e' },
    { fill: 0.86, color: '#eab308' },
  ];
  const rTrack = w / 2;
  const capH = Math.max(3, size * 0.045);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Grundflaeche
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      if (Math.hypot(dx, dy) <= radius) put(x, y, bg);

      lanes.forEach((lane, i) => {
        const lx = inset + i * (w + gap);
        const top = inset;
        const bottom = inset + board;
        if (x < lx || x >= lx + w) return;
        // abgerundete Spur
        const cy = y < top + rTrack ? top + rTrack : y > bottom - rTrack ? bottom - rTrack : y;
        const cx = lx + w / 2;
        const inside = y >= top && y < bottom && Math.hypot(x - cx, y - cy) <= rTrack + 0.5;
        if (!inside) return;
        const level = bottom - board * lane.fill;
        if (y >= level) put(x, y, hex(lane.color));
        else put(x, y, trackCol);
        // heller Griff auf der Fuellkante
        if (y >= level - capH && y < level) put(x, y, [245, 250, 255]);
      });
    }
  }
  return png(size, size, buf);
}

writeFileSync(out('icon-192.png'), icon(192));
writeFileSync(out('icon-512.png'), icon(512));
writeFileSync(out('icon-maskable-512.png'), icon(512, { maskable: true }));
writeFileSync(out('icon-180.png'), icon(180));
console.log('OSC-Icons erzeugt.');
