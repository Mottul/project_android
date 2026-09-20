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

/* ---------------------------------------------------------------- Poti --- */

/* Der Bogen laeuft von links unten (0) ueber oben nach rechts unten (1). */
const KNOB_START = -135;   // Grad, 0 = zwoelf Uhr
const KNOB_SWEEP = 270;    // Grad zwischen Minimum und Maximum

const f1 = (n) => n.toFixed(1);

/** Punkt auf dem Kreis um die Mitte (50/50). */
function knobPoint(deg, r) {
  const a = (deg - 90) * Math.PI / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
}

/**
 * Kreisbogen von `from` nach `to` (Grad).
 * Das grosse Bogenstueck gilt ab 180 Grad — nicht ab der halben Strecke;
 * genau daran lag der Bogen, der bei etwa der Haelfte falsch herum lief.
 */
function arcPath(from, to, r) {
  const [sx, sy] = knobPoint(from, r);
  const [ex, ey] = knobPoint(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to >= from ? 1 : 0;
  return `M ${f1(sx)} ${f1(sy)} A ${r} ${r} 0 ${large} ${sweep} ${f1(ex)} ${f1(ey)}`;
}

/** Voller Ring — Hintergrund des Endlos-Encoders. */
function ringPath(r) {
  const [tx, ty] = knobPoint(0, r);
  const [bx, by] = knobPoint(180, r);
  return `M ${f1(tx)} ${f1(ty)} A ${r} ${r} 0 1 1 ${f1(bx)} ${f1(by)} A ${r} ${r} 0 1 1 ${f1(tx)} ${f1(ty)}`;
}

/**
 * Bogen fuer eine Stellung 0..1 — ausgelagert, damit er pruefbar bleibt.
 * Bei 0 bleibt er leer, sonst laeuft er vom Minimum bis zur Stellung.
 */
export function knobArcPath(n, r = 38) {
  const v = clamp01(n);
  return v <= 0.001 ? '' : arcPath(KNOB_START, KNOB_START + v * KNOB_SWEEP, r);
}

/**
 * Ein Poti zeichnen — von der einzelnen Kachel und von der Poti-Bank genutzt.
 * Das SVG skaliert ueber `preserveAspectRatio` mit und bleibt dabei mittig,
 * egal wie hoch oder schmal die Kachel ist.
 */
function makeKnob(cls = 'knob') {
  const wrap = el('div', cls);
  wrap.innerHTML =
    '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
    '<circle class="k-bg" cx="50" cy="50" r="38"/>' +
    '<path class="k-track" d=""/>' +
    '<path class="k-arc" d=""/>' +
    '<line class="k-ptr" x1="50" y1="50" x2="50" y2="18"/>' +
    '</svg>';
  const track = wrap.querySelector('.k-track');
  const arc = wrap.querySelector('.k-arc');
  const ptr = wrap.querySelector('.k-ptr');
  const aim = (deg) => {
    const [px, py] = knobPoint(deg, 34);
    ptr.setAttribute('x2', f1(px));
    ptr.setAttribute('y2', f1(py));
  };
  return {
    el: wrap,
    /** Stellung 0..1 auf dem 270-Grad-Bogen. */
    value(n) {
      const v = clamp01(n);
      const deg = KNOB_START + v * KNOB_SWEEP;
      aim(deg);
      track.setAttribute('d', arcPath(KNOB_START, KNOB_START + KNOB_SWEEP, 38));
      arc.setAttribute('d', knobArcPath(v));
    },
    /** Endlos-Encoder: freie Drehung, `turns` = Umdrehungen. */
    spin(turns) {
      const deg = turns * 360;
      aim(deg);
      // Voller Ring statt Skala — und eine Marke, die mitwandert. So sieht man
      // sofort, dass sich etwas dreht, obwohl es kein Anfang und kein Ende gibt.
      track.setAttribute('d', ringPath(38));
      arc.setAttribute('d', arcPath(deg - 24, deg + 24, 38));
    },
  };
}

/** Spaltenzahl einer Bank/Auswahl (0 = automatisch moeglichst quadratisch). */
function bankCols(w) {
  if (w.cols > 0) return w.cols;
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(w.items.length || 1))));
}

/**
 * Baut ein Bedienelement.
 * @param {object} w    Widget-Daten (wird bei Aenderungen mutiert)
 * @param {object} ctx  { send(address,args,now), commit(), live }
 * @returns {{el:HTMLElement, paint():void, feedback(args,types,address):void, busy():boolean}}
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
    const knob = makeKnob();
    body.append(knob.el);
    const STEP = 0.08;   // Zieh-Weg je Schritt beim Endlos-Encoder
    let acc = 0;         // Rest bis zum naechsten Schritt
    let spin = 0;        // Zeigerstellung des Endlos-Encoders (Umdrehungen)
    let steps = 0;       // Schritte der laufenden Bewegung — als Rueckmeldung

    api.paint = () => {
      if (w.endless) {
        knob.spin(spin);
        val.textContent = steps === 0 ? '∞' : `∞ ${steps > 0 ? '+' : '−'}${Math.abs(steps)}`;
        return;
      }
      knob.value(norm(w, w.value));
      val.textContent = fmt(w.value);
    };
    drag(knob.el, {
      axis: 'y',
      onStart: () => { touching = true; acc = 0; steps = 0; },
      onMove: (dx, dy, fine) => {
        const d = -dy / 160 * fine;
        if (w.endless) {
          // Der Zeiger dreht mit der Hand, die Schritte gehen einzeln raus.
          spin += d;
          acc += d;
          while (acc >= STEP) { acc -= STEP; steps += 1; send(w.address, [{ type: 'i', value: 1 }], true); }
          while (acc <= -STEP) { acc += STEP; steps -= 1; send(w.address, [{ type: 'i', value: -1 }], true); }
          api.paint();
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

  /* ---------------------------------------------------- Bank aus Potis --- */
  if (w.type === 'bank' && w.bankMode === 'knob') {
    const grid = el('div', 'pads knobs');
    grid.style.gridTemplateColumns = `repeat(${bankCols(w)}, minmax(0,1fr))`;
    body.append(grid);
    const cells = [];

    const paintCell = (i) => {
      const c = cells[i];
      if (!c) return;
      c.knob.value(norm(w, c.item.value));
      c.cap.textContent = c.item.label || String(i + 1);
    };

    w.items.forEach((item, i) => {
      const cell = el('div', 'kcell');
      const knob = makeKnob('knob mini');
      const cap = el('span', 'kcap');
      cell.append(knob.el, cap);
      grid.append(cell);
      cells.push({ knob, cap, item });
      // Ohne eigene Adresse geht der Eintrag an die Adresse des Bauteils.
      const addr = () => item.address || w.address;
      drag(knob.el, {
        axis: 'y',
        onStart: () => { touching = true; },
        onMove: (dx, dy, fine) => {
          item.value = clamp(item.value + (-dy / 160) * fine * span(w), lo(w), hi(w));
          paintCell(i);
          val.textContent = `${item.label || i + 1} · ${fmt(item.value)}`;
          send(addr(), [arg(w, item.value)]);
        },
        onEnd: (moved) => {
          touching = false;
          if (!moved) return;
          send(addr(), [arg(w, item.value)], true);
          ctx.commit();
        },
      });
    });

    api.paint = () => { cells.forEach((c, i) => paintCell(i)); };
    api.feedback = (args, types, address) => {
      if (touching || typeof args[0] !== 'number') return;
      cells.forEach((c, i) => {
        if ((c.item.address || w.address) !== address) return;
        c.item.value = clamp(args[0], lo(w), hi(w));
        paintCell(i);
      });
    };
  }

  /* ------------------------------------------------------ Bank/Auswahl --- */
  if ((w.type === 'bank' && w.bankMode !== 'knob') || w.type === 'select') {
    const grid = el('div', 'pads');
    body.append(grid);
    const cells = [];
    grid.style.gridTemplateColumns = `repeat(${bankCols(w)}, minmax(0,1fr))`;

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
