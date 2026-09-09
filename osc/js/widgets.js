/**
 * Die Bedienelemente: Aufbau im DOM und ihr Verhalten am Finger.
 *
 * Grundsaetze (bewusst so, weil live bedient wird):
 *  - Fader, Poti, XY und Farbe ziehen RELATIV. Beruehren aendert nie den Wert;
 *    erst die Bewegung. Damit reisst kein Regler beim Antippen auf.
 *  - Seitliches Ausweichen macht den Griff FEIN (1/4, dann 1/12). Wie am Pult.
 *  - Waehrend ein Element beruehrt wird, ueberschreibt eingehendes Feedback es
 *    nicht.
 *  - Alles hat `touch-action: none` und Pointer-Capture: kein Scrollen,
 *    kein Doppeltipp-Zoom, kein verlorener Finger.
 */

import { clamp, clamp01 } from './model.js';

const HOLD = 40;    // px seitlich -> feiner Griff
const HOLD2 = 120;  // px seitlich -> sehr feiner Griff

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Zahl fuer die Anzeige: ganzzahlig ohne Komma, sonst zwei Stellen. */
export function fmt(v) {
  if (!Number.isFinite(v)) return '–';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

const lo = (w) => Math.min(w.min, w.max);
const hi = (w) => Math.max(w.min, w.max);
const span = (w) => (hi(w) - lo(w)) || 1;
const norm = (w, v) => clamp01((v - lo(w)) / span(w));

/** Wert gemaess Widget-Typ ('f' oder 'i') als OSC-Argument. */
export const arg = (w, v) => (w.argType === 'i' ? { type: 'i', value: Math.round(v) } : { type: 'f', value: v });

/**
 * Relatives Ziehen mit Feinstufen.
 * @param {HTMLElement} node   Flaeche, auf der gezogen wird
 * onEnd bekommt mit, ob wirklich gezogen wurde — ein blosses Antippen schickt
 * dadurch gar nichts.
 * @param {object} opt  {axis:'y'|'x'|'xy', onStart, onMove(dx,dy,fine), onEnd(moved)}
 */
function drag(node, opt) {
  let active = null;
  node.addEventListener('pointerdown', (ev) => {
    if (active) return;
    node.setPointerCapture(ev.pointerId);
    active = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY };
    node.classList.add('grab');
    opt.onStart?.(ev);
    ev.preventDefault();
  });
  node.addEventListener('pointermove', (ev) => {
    if (!active || ev.pointerId !== active.id) return;
    const cross = opt.axis === 'x' ? Math.abs(ev.clientY - active.sy) : Math.abs(ev.clientX - active.sx);
    const fine = opt.axis === 'xy' ? 1 : cross > HOLD2 ? 1 / 12 : cross > HOLD ? 1 / 4 : 1;
    const dx = ev.clientX - active.x;
    const dy = ev.clientY - active.y;
    active.x = ev.clientX;
    active.y = ev.clientY;
    active.moved = true;
    opt.onMove?.(dx, dy, fine);
    node.classList.toggle('fine', fine < 1);
  });
  const stop = (ev) => {
    if (!active || (ev && ev.pointerId !== active.id)) return;
    const moved = !!active.moved;
    try { node.releasePointerCapture(active.id); } catch { /* egal */ }
    active = null;
    node.classList.remove('grab', 'fine');
    opt.onEnd?.(moved);
  };
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
}

let hapticsOn = true;
/** Vibrieren global an-/abschalten (Einstellung). */
export const setHaptics = (on) => { hapticsOn = !!on; };

/** Kurzes haptisches Feedback, falls das Geraet es kann. */
function tick(ms = 12) {
  if (!hapticsOn) return;
  try { navigator.vibrate?.(ms); } catch { /* egal */ }
}

/**
 * Baut ein Bedienelement.
 * @param {object} w    Widget-Daten (wird bei Aenderungen mutiert)
 * @param {object} ctx  { send(address,args,now), commit(), live }
 * @returns {{el:HTMLElement, paint():void, feedback(args,types):void, busy():boolean}}
 */
export function createWidget(w, ctx) {
  const tile = el('div', `tile t-${w.type}`);
  tile.dataset.id = w.id;
  tile.style.setProperty('--c', w.color);

  const head = el('div', 'tile-head');
  const name = el('span', 'tile-name', w.label);
  const val = el('span', 'tile-val');
  head.append(name, val);

  const body = el('div', 'tile-body');
  if (w.type !== 'label') tile.append(head, body);
  else tile.append(body);

  let touching = false;
  const api = {
    el: tile,
    paint: () => {},
    feedback: () => {},
    busy: () => touching,
  };

  const send = (address, args, now = false) => {
    if (!ctx.live) return;
    if (!address) return;
    ctx.send(address, args, now);
  };

  /* ------------------------------------------------------------- Fader --- */
  if (w.type === 'fader') {
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    track.append(fill);
    body.append(track);
    tile.classList.toggle('horizontal', w.orient === 'h');

    api.paint = () => {
      const n = norm(w, w.value);
      if (w.orient === 'h') { fill.style.width = `${n * 100}%`; fill.style.height = '100%'; }
      else { fill.style.height = `${n * 100}%`; fill.style.width = '100%'; }
      val.textContent = fmt(w.value);
    };
    drag(track, {
      axis: w.orient === 'h' ? 'x' : 'y',
      onStart: () => { touching = true; },
      onMove: (dx, dy, fine) => {
        const r = track.getBoundingClientRect();
        const d = w.orient === 'h' ? dx / Math.max(1, r.width) : -dy / Math.max(1, r.height);
        w.value = clamp(w.value + d * span(w) * fine, lo(w), hi(w));
        api.paint();
        send(w.address, [arg(w, w.value)]);
      },
      onEnd: (moved) => { touching = false; if (moved) { send(w.address, [arg(w, w.value)], true); ctx.commit(); } },
    });
    api.feedback = (args) => {
      if (touching || typeof args[0] !== 'number') return;
      w.value = clamp(args[0], lo(w), hi(w));
      api.paint();
    };
  }

  /* -------------------------------------------------------------- Poti --- */
  if (w.type === 'knob') {
    const wrap = el('div', 'knob');
    wrap.innerHTML =
      '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="k-bg" cx="50" cy="50" r="38"/>' +
      '<path class="k-arc" d="" />' +
      '<line class="k-ptr" x1="50" y1="50" x2="50" y2="18"/>' +
      '</svg>';
    body.append(wrap);
    const arc = wrap.querySelector('.k-arc');
    const ptr = wrap.querySelector('.k-ptr');
    let acc = 0;

    const polar = (n, r) => {
      const a = (-135 + n * 270 - 90) * Math.PI / 180;
      return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
    };
    api.paint = () => {
      const n = w.endless ? 0.5 : norm(w, w.value);
      const [px, py] = polar(n, 34);
      ptr.setAttribute('x2', px.toFixed(1));
      ptr.setAttribute('y2', py.toFixed(1));
      if (w.endless) { arc.setAttribute('d', ''); val.textContent = '∞'; return; }
      const [sx, sy] = polar(0, 38);
      const [ex, ey] = polar(n, 38);
      arc.setAttribute('d', n <= 0.001 ? '' : `M ${sx.toFixed(1)} ${sy.toFixed(1)} A 38 38 0 ${n > 0.5 ? 1 : 0} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`);
      val.textContent = fmt(w.value);
    };
    drag(wrap, {
      axis: 'y',
      onStart: () => { touching = true; acc = 0; },
      onMove: (dx, dy, fine) => {
        const d = -dy / 160 * fine;
        if (w.endless) {
          acc += d;
          while (acc >= 0.08) { acc -= 0.08; send(w.address, [{ type: 'i', value: 1 }], true); }
          while (acc <= -0.08) { acc += 0.08; send(w.address, [{ type: 'i', value: -1 }], true); }
          return;
        }
        w.value = clamp(w.value + d * span(w), lo(w), hi(w));
        api.paint();
        send(w.address, [arg(w, w.value)]);
      },
      onEnd: (moved) => {
        touching = false;
        if (!moved) return;
        if (!w.endless) send(w.address, [arg(w, w.value)], true);
        ctx.commit();
      },
    });
    api.feedback = (args) => {
      if (touching || w.endless || typeof args[0] !== 'number') return;
      w.value = clamp(args[0], lo(w), hi(w));
      api.paint();
    };
  }

  /* ---------------------------------------------------- Schalter/Taster --- */
  if (w.type === 'toggle' || w.type === 'button') {
    const btn = el('button', 'pad', w.label);
    btn.type = 'button';
    body.append(btn);
    head.hidden = true;

    api.paint = () => {
      btn.textContent = w.label;
      tile.classList.toggle('on', w.value >= 0.5);
    };
    if (w.type === 'toggle') {
      btn.addEventListener('click', () => {
        w.value = w.value >= 0.5 ? 0 : 1;
        api.paint();
        tick();
        send(w.address, [arg(w, w.value >= 0.5 ? w.onValue : w.offValue)], true);
        ctx.commit();
      });
    } else {
      const down = (ev) => {
        ev.preventDefault();
        touching = true;
        w.value = 1;
        api.paint();
        tick(15);
        send(w.address, [arg(w, w.onValue)], true);
      };
      const up = () => {
        if (!touching) return;
        touching = false;
        w.value = 0;
        api.paint();
        send(w.address, [arg(w, w.offValue)], true);
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
    api.feedback = (args) => {
      if (touching) return;
      const v = typeof args[0] === 'boolean' ? (args[0] ? 1 : 0) : args[0];
      if (typeof v !== 'number') return;
      w.value = v >= 0.5 ? 1 : 0;
      api.paint();
    };
  }

  /* ------------------------------------------------------ Bank/Auswahl --- */
  if (w.type === 'bank' || w.type === 'select') {
    const grid = el('div', 'pads');
    body.append(grid);
    const cells = [];
    const cols = w.cols > 0 ? w.cols : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(w.items.length || 1))));
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;

    w.items.forEach((item, i) => {
      const b = el('button', 'pad small', item.label || String(i + 1));
      b.type = 'button';
      grid.append(b);
      cells.push(b);
      // Regel: hat der Eintrag eine eigene Adresse, geht dorthin An/Aus.
      // Sonst geht der Wert des Eintrags an die Adresse des Widgets.
      const addr = item.address || w.address;
      const onArgs = () => [arg(w, item.address ? w.onValue : item.value)];
      const offArgs = () => [arg(w, item.address ? w.offValue : item.value)];

      if (w.type === 'select') {
        b.addEventListener('click', () => {
          w.value = i;
          api.paint();
          tick();
          send(addr, onArgs(), true);
          ctx.commit();
        });
      } else if (w.bankMode === 'toggle') {
        b.addEventListener('click', () => {
          item.on = !item.on;
          api.paint();
          tick();
          send(addr, item.on ? onArgs() : offArgs(), true);
          ctx.commit();
        });
      } else {
        b.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          b.dataset.down = '1';
          b.classList.add('on');
          tick(15);
          send(addr, onArgs(), true);
        });
        const rel = () => {
          if (!b.dataset.down) return;
          delete b.dataset.down;
          b.classList.remove('on');
          if (item.address) send(addr, offArgs(), true);
        };
        b.addEventListener('pointerup', rel);
        b.addEventListener('pointercancel', rel);
        b.addEventListener('pointerleave', rel);
      }
    });

    api.paint = () => {
      cells.forEach((b, i) => {
        b.textContent = w.items[i]?.label || String(i + 1);
        const on = w.type === 'select' ? Math.round(w.value) === i : !!w.items[i]?.on;
        b.classList.toggle('on', on);
      });
      val.textContent = w.type === 'select' ? (w.items[Math.round(w.value)]?.label || '') : '';
    };
    api.feedback = (args) => {
      if (w.type !== 'select' || typeof args[0] !== 'number') return;
      const idx = w.items.findIndex((it) => !it.address && Math.abs(it.value - args[0]) < 1e-6);
      if (idx >= 0) { w.value = idx; api.paint(); }
    };
  }

  /* ------------------------------------------------------------- XY-Pad --- */
  if (w.type === 'xy') {
    const pad = el('div', 'xy');
    const dot = el('div', 'xy-dot');
    const hx = el('div', 'xy-h');
    const vy = el('div', 'xy-v');
    pad.append(hx, vy, dot);
    body.append(pad);

    const emitXY = (now) => {
      const vx = lo(w) + w.x * span(w);
      const vy2 = lo(w) + w.y * span(w);
      if (w.addressY) {
        send(w.address, [arg(w, vx)], now);
        send(w.addressY, [arg(w, vy2)], now);
      } else {
        send(w.address, [arg(w, vx), arg(w, vy2)], now);
      }
    };
    api.paint = () => {
      dot.style.left = `${w.x * 100}%`;
      dot.style.top = `${(1 - w.y) * 100}%`;
      vy.style.left = `${w.x * 100}%`;
      hx.style.top = `${(1 - w.y) * 100}%`;
      val.textContent = `${w.x.toFixed(2)} · ${w.y.toFixed(2)}`;
    };
    drag(pad, {
      axis: 'xy',
      onStart: () => { touching = true; },
      onMove: (dx, dy) => {
        const r = pad.getBoundingClientRect();
        w.x = clamp01(w.x + dx / Math.max(1, r.width));
        w.y = clamp01(w.y - dy / Math.max(1, r.height));
        api.paint();
        emitXY(false);
      },
      onEnd: (moved) => { touching = false; if (moved) { emitXY(true); ctx.commit(); } },
    });
    api.feedback = (args) => {
      if (touching) return;
      if (typeof args[0] === 'number') w.x = norm(w, args[0]);
      if (typeof args[1] === 'number') w.y = norm(w, args[1]);
      api.paint();
    };
  }

  /* -------------------------------------------------------------- Farbe --- */
  if (w.type === 'color') {
    const swatch = el('div', 'swatch');
    const rows = el('div', 'crows');
    body.append(swatch, rows);
    const chans = ['r', 'g', 'b', 'a'];
    const bars = {};
    for (const ch of chans) {
      const row = el('div', 'crow');
      const tag = el('span', 'ctag', ch.toUpperCase());
      const track = el('div', `ctrack c-${ch}`);
      const fill = el('div', 'cfill');
      track.append(fill);
      row.append(tag, track);
      rows.append(row);
      bars[ch] = fill;
      drag(track, {
        axis: 'x',
        onStart: () => { touching = true; },
        onMove: (dx, dy, fine) => {
          const r = track.getBoundingClientRect();
          w[ch] = clamp01(w[ch] + (dx / Math.max(1, r.width)) * fine);
          api.paint();
          send(w.address, [{ type: 'f', value: w.r }, { type: 'f', value: w.g }, { type: 'f', value: w.b }, { type: 'f', value: w.a }]);
        },
        onEnd: (moved) => {
          touching = false;
          if (!moved) return;
          send(w.address, [{ type: 'f', value: w.r }, { type: 'f', value: w.g }, { type: 'f', value: w.b }, { type: 'f', value: w.a }], true);
          ctx.commit();
        },
      });
    }
    api.paint = () => {
      const c = (v) => Math.round(clamp01(v) * 255);
      swatch.style.background = `rgb(${c(w.r)} ${c(w.g)} ${c(w.b)} / ${w.a})`;
      for (const ch of chans) bars[ch].style.width = `${w[ch] * 100}%`;
      val.textContent = `#${[w.r, w.g, w.b].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
    };
    api.feedback = (args) => {
      if (touching) return;
      const [r, g, b, a] = args;
      if (typeof r === 'number') w.r = clamp01(r);
      if (typeof g === 'number') w.g = clamp01(g);
      if (typeof b === 'number') w.b = clamp01(b);
      if (typeof a === 'number') w.a = clamp01(a);
      api.paint();
    };
  }

  /* --------------------------------------------------------------- Text --- */
  if (w.type === 'label') {
    const t = el('div', 'label-text');
    body.append(t);
    api.paint = () => {
      t.textContent = w.label;
      t.style.textAlign = w.align;
      t.style.color = w.color;
    };
  }

  /* ------------------------------------------------------------ Anzeige --- */
  if (w.type === 'meter') {
    const big = el('div', 'meter-val');
    const bar = el('div', 'meter-bar');
    const fill = el('div', 'meter-fill');
    bar.append(fill);
    body.append(big, bar);
    api.paint = () => {
      if (w.source === 'text') {
        big.textContent = w.text || '–';
        bar.hidden = true;
      } else {
        big.textContent = fmt(w.value);
        bar.hidden = false;
        fill.style.width = `${norm(w, w.value) * 100}%`;
      }
      val.textContent = '';
    };
    api.feedback = (args) => {
      const first = args[0];
      if (w.source === 'text') w.text = args.map((a) => (typeof a === 'number' ? fmt(a) : String(a))).join(' ');
      else if (typeof first === 'number') w.value = first;
      else if (typeof first === 'boolean') w.value = first ? 1 : 0;
      api.paint();
    };
  }

  api.paint();
  return api;
}
