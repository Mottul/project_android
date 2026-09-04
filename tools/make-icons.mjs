/**
 * Erzeugt die PWA-Icons als PNG — ohne externe Abhaengigkeiten.
 * Aufruf: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

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
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // Filter: none
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

/** Zeichnet das Logo: LED-Kabinette in vier Signalfarben auf dunklem Grund. */
function icon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = hex('#0d1117');
  const radius = maskable ? 0 : size * 0.22;
  const inset = maskable ? size * 0.20 : size * 0.16; // Maskable: Safe Zone einhalten
  const tiles = ['#38bdf8', '#f97316', '#a3e635', '#e879f9'];
  const board = size - inset * 2;
  const gap = board * 0.07;
  const cell = (board - gap) / 2;

  const put = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    const inv = 1 - a / 255;
    buf[i] = Math.round(r * (a / 255) + buf[i] * inv);
    buf[i + 1] = Math.round(g * (a / 255) + buf[i + 1] * inv);
    buf[i + 2] = Math.round(b * (a / 255) + buf[i + 2] * inv);
    buf[i + 3] = Math.max(buf[i + 3], a);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Abgerundete Grundflaeche
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      if (Math.hypot(dx, dy) <= radius) put(x, y, bg);

      // Vier Kabinette
      for (let t = 0; t < 4; t++) {
        const cx = inset + (t % 2) * (cell + gap);
        const cy = inset + Math.floor(t / 2) * (cell + gap);
        if (x >= cx && x < cx + cell && y >= cy && y < cy + cell) {
          const edge = 2 + size * 0.012;
          const border =
            x < cx + edge || x >= cx + cell - edge || y < cy + edge || y >= cy + cell - edge;
          put(x, y, hex(tiles[t]), border ? 255 : 70);
        }
      }
    }
  }
  return png(size, size, buf);
}

writeFileSync('icons/icon-192.png', icon(192));
writeFileSync('icons/icon-512.png', icon(512));
writeFileSync('icons/icon-maskable-512.png', icon(512, { maskable: true }));
writeFileSync('icons/icon-180.png', icon(180));
console.log('Icons erzeugt.');
