/**
 * OSC 1.0 — Encoder und Decoder fuer den Browser (ohne Abhaengigkeiten).
 *
 * Alles ist big-endian, Strings sind null-terminiert und auf ein Vielfaches
 * von 4 Byte aufgefuellt. Gesendet werden die Typen i (int32), f (float32),
 * s (string), T/F (wahr/falsch). Gelesen wird zusaetzlich d, h, S, N, I und b,
 * damit Feedback fremder Programme nicht am Decoder scheitert.
 *
 * Diese Datei laeuft unveraendert im Browser und in Node (Tests).
 */

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

/** Naechste durch 4 teilbare Position. */
export const align4 = (n) => n + ((4 - (n % 4)) % 4);

/** Laenge eines OSC-Strings in Bytes (inkl. mindestens einem Nullbyte). */
function stringSize(bytes) {
  return align4(bytes.length + 1);
}

/**
 * Baut eine OSC-Nachricht.
 * @param {string} address  z. B. "/surfaces/1/opacity"
 * @param {Array<{type:string,value:*}>} args
 * @returns {ArrayBuffer}
 */
export function encodeMessage(address, args = []) {
  const addr = String(address || '/').trim();
  const addrBytes = enc.encode(addr.startsWith('/') ? addr : `/${addr}`);

  let tags = ',';
  const parts = []; // { bytes } fuer Strings, { num, kind } fuer Zahlen
  let payload = 0;

  for (const a of args) {
    switch (a.type) {
      case 'i':
        tags += 'i';
        parts.push({ kind: 'i', num: a.value | 0 });
        payload += 4;
        break;
      case 'f':
        tags += 'f';
        parts.push({ kind: 'f', num: Number.isFinite(a.value) ? a.value : 0 });
        payload += 4;
        break;
      case 's': {
        tags += 's';
        const b = enc.encode(String(a.value ?? ''));
        parts.push({ kind: 's', bytes: b });
        payload += stringSize(b);
        break;
      }
      case 'T':
        tags += 'T';
        break;
      case 'F':
        tags += 'F';
        break;
      default:
        throw new TypeError(`Unbekannter OSC-Typ: ${a.type}`);
    }
  }

  const tagBytes = enc.encode(tags);
  const size = stringSize(addrBytes) + stringSize(tagBytes) + payload;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  let p = 0;
  u8.set(addrBytes, p);
  p += stringSize(addrBytes);
  u8.set(tagBytes, p);
  p += stringSize(tagBytes);

  for (const part of parts) {
    if (part.kind === 'i') {
      view.setInt32(p, part.num, false);
      p += 4;
    } else if (part.kind === 'f') {
      view.setFloat32(p, part.num, false);
      p += 4;
    } else {
      u8.set(part.bytes, p);
      p += stringSize(part.bytes);
    }
  }
  return buf;
}

/** Liest einen OSC-String ab `pos`; gibt Text und neue Position zurueck. */
function readString(u8, pos, end) {
  let e = pos;
  while (e < end && u8[e] !== 0) e += 1;
  const text = dec.decode(u8.subarray(pos, e));
  return { text, next: align4(e + 1) };
}

/**
 * Dekodiert ein OSC-Paket (Nachricht oder #bundle) zu flachen Eintraegen.
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Array<{address:string,args:Array<number|string|boolean>,types:string}>}
 */
export function decodePacket(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const out = [];
  readPacket(u8, 0, u8.length, out, 0);
  return out;
}

function readPacket(u8, start, end, out, depth) {
  if (end - start < 8 || depth > 8) return;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // "#bundle\0" + 8 Byte Zeitstempel, danach je [int32 Laenge][Paket].
  if (u8[start] === 0x23) {
    let p = start + 16;
    while (p + 4 <= end) {
      const size = view.getInt32(p, false);
      p += 4;
      if (size < 0 || p + size > end) break;
      readPacket(u8, p, p + size, out, depth + 1);
      p += size;
    }
    return;
  }

  const addr = readString(u8, start, end);
  if (!addr.text.startsWith('/')) return;
  let p = addr.next;
  const args = [];
  let types = '';

  if (p < end && u8[p] === 0x2c /* ',' */) {
    const tagRead = readString(u8, p, end);
    p = tagRead.next;
    const tags = tagRead.text;
    for (let i = 1; i < tags.length; i += 1) {
      const t = tags[i];
      try {
        if (t === 'i') { args.push(view.getInt32(p, false)); p += 4; }
        else if (t === 'f') { args.push(view.getFloat32(p, false)); p += 4; }
        else if (t === 'd') { args.push(view.getFloat64(p, false)); p += 8; }
        else if (t === 'h' || t === 't') { args.push(Number(view.getBigInt64(p, false))); p += 8; }
        else if (t === 's' || t === 'S') { const r = readString(u8, p, end); args.push(r.text); p = r.next; }
        else if (t === 'T') args.push(true);
        else if (t === 'F') args.push(false);
        else if (t === 'N') args.push(null);
        else if (t === 'I') args.push(Infinity);
        else if (t === 'b') { const len = view.getInt32(p, false); args.push(len); p = align4(p + 4 + Math.max(0, len)); }
        else break; // unbekannter Typ -> Rest ist nicht mehr deutbar
        types += t;
      } catch {
        break; // abgeschnittenes Paket
      }
      if (p > end) break;
    }
  }
  out.push({ address: addr.text, args, types });
}

/** Lesbare Kurzform fuer Log und Monitor: "/adresse 0.50 1". */
export function formatMessage(address, args) {
  const parts = args.map((a) => {
    const v = a && typeof a === 'object' && 'value' in a ? a.value : a;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    if (typeof v === 'boolean') return v ? 'T' : 'F';
    if (v === null) return 'N';
    return JSON.stringify(String(v));
  });
  return parts.length ? `${address} ${parts.join(' ')}` : address;
}

/**
 * Prueft eine OSC-Adresse grob: muss mit / beginnen und darf die von der
 * Spezifikation verbotenen Zeichen nicht enthalten.
 */
export function isValidAddress(address) {
  const a = String(address || '');
  if (!a.startsWith('/') || a.length < 2) return false;
  return !/[ #]/.test(a);
}
