/**
 * Bearbeiten-Modus: Kacheln verschieben und groesser ziehen, Inspektor.
 *
 * Verschoben wird im Raster — es rastet ein. Waehrend des Ziehens zeigt ein
 * Umriss, wo die Kachel landet; liegt dort schon etwas, weicht das nach unten
 * aus (sonst liesse sich auf einer vollen Seite nichts mehr umstellen). Ein
 * kurzes Antippen oeffnet den Inspektor.
 */

import { TYPES, TYPE_ORDER, COLORS, clamp, fits, dropAt, minSize, MAX_ROWS, uid } from './model.js';

const TAP_PX = 8;
const TAP_MS = 500;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Verschieben/Groesse aendern auf der Flaeche aktivieren (einmal aufrufen).
 * @param {HTMLElement} surface
 * @param {object} cbs { getPage(), isEditing(), onChange(), onTap(widget), onSelect(id) }
 */
export function attachEditing(surface, cbs) {
  let st = null;
  let ghost = null;

  const cellSize = (tile, w) => {
    const r = tile.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(surface).gap) || 8;
    return { cw: (r.width + gap) / w.cw, ch: (r.height + gap) / w.ch };
  };

  const showGhost = (rect) => {
    if (!ghost) { ghost = el('div', 'dropspot'); surface.append(ghost); }
    ghost.style.gridColumn = `${rect.gx + 1} / span ${rect.cw}`;
    ghost.style.gridRow = `${rect.gy + 1} / span ${rect.ch}`;
  };
  const hideGhost = () => { ghost?.remove(); ghost = null; };

  surface.addEventListener('pointerdown', (ev) => {
    if (!cbs.isEditing() || st) return;
    const tile = ev.target.closest('.tile');
    if (!tile) return;
    const page = cbs.getPage();
    const w = page.widgets.find((x) => x.id === tile.dataset.id);
    if (!w) return;

    const resize = !!ev.target.closest('.handle');
    tile.setPointerCapture(ev.pointerId);
    st = {
      id: ev.pointerId, tile, w, resize,
      x0: ev.clientX, y0: ev.clientY, t0: Date.now(),
      orig: { gx: w.gx, gy: w.gy, cw: w.cw, ch: w.ch },
      last: { gx: w.gx, gy: w.gy, cw: w.cw, ch: w.ch },
      cell: cellSize(tile, w),
      moved: false,
    };
    cbs.onSelect?.(w.id);
    ev.preventDefault();
  });

  surface.addEventListener('pointermove', (ev) => {
    if (!st || ev.pointerId !== st.id) return;
    const dx = ev.clientX - st.x0;
    const dy = ev.clientY - st.y0;
    if (!st.moved && Math.hypot(dx, dy) < TAP_PX) return;
    if (!st.moved) { st.moved = true; st.tile.classList.add('moving'); }

    const page = cbs.getPage();
    const dc = Math.round(dx / st.cell.cw);
    const dr = Math.round(dy / st.cell.ch);
    const m = minSize(st.w.type);
    let rect;
    if (st.resize) {
      rect = {
        id: st.w.id, gx: st.orig.gx, gy: st.orig.gy,
        cw: clamp(st.orig.cw + dc, m.cw, page.columns - st.orig.gx),
        ch: clamp(st.orig.ch + dr, m.ch, MAX_ROWS),
      };
    } else {
      rect = {
        id: st.w.id,
        gx: clamp(st.orig.gx + dc, 0, page.columns - st.orig.cw),
        gy: Math.max(0, st.orig.gy + dr),
        cw: st.orig.cw, ch: st.orig.ch,
      };
    }
    st.last = rect;
    showGhost(rect);
    ghost?.classList.toggle('push', !fits(rect, page.widgets, page.columns, st.w.id));
  });

  const stop = (ev) => {
    if (!st || (ev && ev.pointerId !== st.id)) return;
    const { w, tile, moved, last } = st;
    try { tile.releasePointerCapture(st.id); } catch { /* egal */ }
    tile.classList.remove('moving');
    hideGhost();
    const quick = Date.now() - st.t0 < TAP_MS;
    st = null;
    if (moved) {
      const page = cbs.getPage();
      dropAt(page.widgets, page.columns, w, last);
      cbs.onChange();
    } else if (quick) {
      cbs.onTap(w);
    }
  };
  surface.addEventListener('pointerup', stop);
  surface.addEventListener('pointercancel', stop);
}

/* ------------------------------------------------------------- Palette --- */

/** Bauteil-Palette im Bearbeiten-Modus. */
export function buildPalette(node, onAdd) {
  node.replaceChildren();
  for (const type of TYPE_ORDER) {
    const b = el('button', 'chip', TYPES[type].name);
    b.type = 'button';
    b.title = TYPES[type].hint;
    b.addEventListener('click', () => onAdd(type));
    node.append(b);
  }
}

/* ------------------------------------------------------------ Inspektor --- */

function field(label, input) {
  const l = el('label', 'field');
  l.append(el('span', null, label), input);
  return l;
}

function textInput(value, oninput, attrs = {}) {
  const i = el('input');
  i.value = value ?? '';
  Object.assign(i, attrs);
  i.setAttribute('autocapitalize', 'off');
  i.setAttribute('autocorrect', 'off');
  i.spellcheck = false;
  i.addEventListener('input', () => oninput(i.value));
  return i;
}

function numInput(value, oninput, attrs = {}) {
  const i = el('input');
  i.type = 'number';
  i.inputMode = 'decimal';
  i.value = String(value);
  Object.assign(i, attrs);
  i.addEventListener('input', () => {
    const n = Number(i.value);
    if (Number.isFinite(n)) oninput(n);
  });
  return i;
}

function selectInput(value, options, onchange) {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', null, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

function checkbox(label, checked, onchange) {
  const l = el('label', 'check');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!checked;
  i.addEventListener('change', () => onchange(i.checked));
  l.append(i, el('span', null, label));
  return l;
}

function colorRow(current, onpick) {
  const row = el('div', 'row wrap');
  for (const c of COLORS) {
    const b = el('button', 'iconbtn');
    b.type = 'button';
    b.style.background = c;
    b.style.borderColor = c === current ? '#fff' : 'transparent';
    b.setAttribute('aria-label', c);
    b.addEventListener('click', () => onpick(c));
    row.append(b);
  }
  return row;
}

/**
 * Inspektor fuellen.
 * @param {HTMLElement} body
 * @param {object} w
 * @param {object} page
 * @param {object} cbs { onChange(), onDelete(), onDuplicate(), rerender() }
 */
export function buildInspector(body, w, page, cbs) {
  body.replaceChildren();
  const change = () => cbs.onChange();
  const rebuild = () => { buildInspector(body, w, page, cbs); cbs.onChange(); };

  const isValue = ['fader', 'knob', 'meter', 'xy'].includes(w.type);
  const isSwitch = ['toggle', 'button', 'bank'].includes(w.type);
  const hasItems = ['bank', 'select'].includes(w.type);

  body.append(field('Beschriftung', textInput(w.label, (v) => { w.label = v; change(); })));

  if (w.type !== 'label') {
    body.append(field('OSC-Adresse', textInput(w.address, (v) => { w.address = v.trim(); change(); }, { placeholder: '/surfaces/1/opacity' })));
  }
  if (w.type === 'xy') {
    body.append(field('Adresse Y (leer = beide Werte an die Adresse oben)',
      textInput(w.addressY, (v) => { w.addressY = v.trim(); change(); }, { placeholder: '/surfaces/1/position/y' })));
  }

  if (isValue) {
    const g = el('div', 'grid2');
    g.append(field('Minimum', numInput(w.min, (v) => { w.min = v; change(); })),
             field('Maximum', numInput(w.max, (v) => { w.max = v; change(); })));
    body.append(g);
  }
  if (isSwitch || hasItems) {
    const g = el('div', 'grid2');
    g.append(field('Wert „an"', numInput(w.onValue, (v) => { w.onValue = v; change(); })),
             field('Wert „aus"', numInput(w.offValue, (v) => { w.offValue = v; change(); })));
    body.append(g);
  }
  if (w.type !== 'label' && w.type !== 'meter') {
    body.append(field('Zahlentyp', selectInput(w.argType, [['f', 'Kommazahl (float)'], ['i', 'Ganzzahl (int)']],
      (v) => { w.argType = v; change(); })));
  }

  if (w.type === 'fader' || w.type === 'color') {
    body.append(field('Ausrichtung', selectInput(w.orient, [['v', 'senkrecht'], ['h', 'waagerecht']],
      (v) => { w.orient = v; rebuild(); })));
  }
  if (w.type === 'knob') body.append(checkbox('Endlos-Encoder (sendet Schritte ±1)', w.endless, (v) => { w.endless = v; rebuild(); }));
  if (w.type === 'bank') {
    body.append(field('Verhalten', selectInput(w.bankMode, [['momentary', 'Taster'], ['toggle', 'Schalter']],
      (v) => { w.bankMode = v; rebuild(); })));
  }
  if (hasItems) {
    body.append(field('Spalten (0 = automatisch)', numInput(w.cols, (v) => { w.cols = clamp(Math.round(v), 0, 12); rebuild(); }, { min: 0, max: 12, step: 1 })));
  }
  if (w.type === 'label') {
    body.append(field('Ausrichtung', selectInput(w.align, [['left', 'links'], ['center', 'mittig'], ['right', 'rechts']],
      (v) => { w.align = v; change(); })));
  }
  if (w.type === 'meter') {
    body.append(field('Anzeigen als', selectInput(w.source, [['number', 'Zahl mit Balken'], ['text', 'Text']],
      (v) => { w.source = v; rebuild(); })));
  }

  /* Eintraege von Bank und Auswahl */
  if (hasItems) {
    body.append(el('h3', null, 'Eintraege'));
    const hint = el('p', 'note', 'Mit eigener Adresse sendet der Eintrag „an"/„aus" dorthin. Ohne Adresse geht sein Wert an die Adresse des Bauteils.');
    body.append(hint);
    const list = el('div');
    w.items.forEach((item, i) => {
      const row = el('div', 'itemrow');
      row.append(
        textInput(item.label, (v) => { item.label = v; change(); }, { placeholder: 'Name' }),
        textInput(item.address, (v) => { item.address = v.trim(); change(); }, { placeholder: '/adresse' }),
        numInput(item.value, (v) => { item.value = v; change(); }),
      );
      const del = el('button', 'iconbtn', '✕');
      del.type = 'button';
      del.addEventListener('click', () => { w.items.splice(i, 1); rebuild(); });
      row.append(del);
      list.append(row);
    });
    body.append(list);
    const add = el('button', 'btn', 'Eintrag hinzufuegen');
    add.type = 'button';
    add.addEventListener('click', () => {
      w.items.push({ label: `${w.items.length + 1}`, address: '', value: w.items.length + 1 });
      rebuild();
    });
    body.append(add);
  }

  body.append(el('h3', null, 'Farbe'));
  body.append(colorRow(w.color, (c) => { w.color = c; rebuild(); }));

  body.append(el('h3', null, 'Groesse'));
  const g2 = el('div', 'grid2');
  const m = minSize(w.type);
  g2.append(
    field('Breite (Spalten)', numInput(w.cw, (v) => { w.cw = clamp(Math.round(v), m.cw, page.columns); change(); }, { min: m.cw, max: page.columns, step: 1 })),
    field('Hoehe (Zeilen)', numInput(w.ch, (v) => { w.ch = clamp(Math.round(v), m.ch, MAX_ROWS); change(); }, { min: m.ch, max: MAX_ROWS, step: 1 })),
  );
  body.append(g2);

  const actions = el('div', 'row wrap');
  const dup = el('button', 'btn', 'Duplizieren');
  dup.type = 'button';
  dup.addEventListener('click', () => cbs.onDuplicate());
  const del = el('button', 'btn danger', 'Loeschen');
  del.type = 'button';
  del.addEventListener('click', () => cbs.onDelete());
  actions.append(dup, del);
  body.append(el('h3', null, 'Aktionen'), actions);
}

/** Kopie eines Widgets mit neuer Kennung und ohne Position. */
export function duplicateWidget(w) {
  return { ...JSON.parse(JSON.stringify(w)), id: uid(), gx: -1, gy: -1 };
}
