/**
 * Bearbeiten-Modus: Kacheln verschieben und groesser ziehen, Inspektor.
 *
 * Verschoben wird im Raster — es rastet ein. Waehrend des Ziehens zeigt ein
 * Umriss, wo die Kachel landet; liegt dort schon etwas, weicht das nach unten
 * aus (sonst liesse sich auf einer vollen Seite nichts mehr umstellen).
 *
 * Antippen: der erste Tipp WAEHLT nur aus — dann liegen Duplizieren und
 * Loeschen in der Leiste bereit; der zweite Tipp auf dieselbe Kachel oeffnet
 * die Einstellungen. Ein Tipp ins Leere hebt die Auswahl auf und legt
 * ausdruecklich nichts an; wer an einer bestimmten Stelle etwas einfuegen
 * will, haelt dort kurz den Finger auf.
 *
 * Groesse: die Ecke unten rechts. Nicht nur der sichtbare Griff zaehlt, sondern
 * eine ganze Ecke — auf kleinen Kacheln entsprechend kleiner, damit Verschieben
 * moeglich bleibt.
 */

import { COLORS, clamp, fits, dropAt, minSize, MAX_ROWS, TYPES, bumpNumber, copyWidget,
  defaultPalette } from './model.js';
import { uiIcon } from './icons.js';

const TAP_PX = 8;
const TAP_MS = 500;
const HOLD_MS = 420;   // so lange auf leerer Flaeche halten = hier einfuegen

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Verschieben/Groesse aendern auf der Flaeche aktivieren (einmal aufrufen).
 * @param {HTMLElement} surface
 * @param {object} cbs { getPage(), isEditing(), selectedId(), onChange(),
 *                       onSelect(id), onOpen(widget), onEmptyHold(cell),
 *                       onSnapshot(label) — vor einer Aenderung, fuers Zurueck }
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

  /** Rasterzelle unter einem Punkt (fuers Einfuegen per langem Druck). */
  const cellAt = (ev) => {
    const page = cbs.getPage();
    const r = surface.getBoundingClientRect();
    const cs = getComputedStyle(surface);
    const gap = parseFloat(cs.gap) || 8;
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const inner = r.width - padL - (parseFloat(cs.paddingRight) || 0);
    const colPitch = (inner + gap) / page.columns;
    const rowPitch = (parseFloat(cs.getPropertyValue('--rowh')) || 40) + gap;
    const x = ev.clientX - r.left - padL + surface.scrollLeft;
    const y = ev.clientY - r.top - padT + surface.scrollTop;
    return {
      gx: clamp(Math.floor(x / colPitch), 0, page.columns - 1),
      gy: Math.max(0, Math.floor(y / rowPitch)),
    };
  };

  const clearHold = () => { if (st?.timer) { clearTimeout(st.timer); st.timer = 0; } };

  surface.addEventListener('pointerdown', (ev) => {
    if (!cbs.isEditing() || st) return;
    const tile = ev.target.closest('.tile');
    if (!tile) {
      // Leere Flaeche: kurz tippen hebt die Auswahl auf, halten fuegt hier ein.
      const cell = cellAt(ev);
      st = { empty: true, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, t0: Date.now(), cell, moved: false };
      st.timer = setTimeout(() => {
        if (!st || !st.empty || st.moved) return;
        st.held = true;
        cbs.onEmptyHold?.(cell);
      }, HOLD_MS);
      return;
    }
    const page = cbs.getPage();
    const w = page.widgets.find((x) => x.id === tile.dataset.id);
    if (!w) return;

    // Ecke unten rechts zieht die Groesse — auf kleinen Kacheln kleiner, damit
    // zum Verschieben genug Flaeche bleibt.
    const box = tile.getBoundingClientRect();
    const zone = Math.min(44, box.width * 0.4, box.height * 0.4);
    const inCorner = ev.clientX > box.right - zone && ev.clientY > box.bottom - zone;
    const resize = !!ev.target.closest('.handle') || inCorner;
    tile.setPointerCapture(ev.pointerId);
    st = {
      id: ev.pointerId, tile, w, resize,
      wasSelected: cbs.selectedId?.() === w.id,
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
    if (st.empty) { if (Math.hypot(dx, dy) >= TAP_PX) { st.moved = true; clearHold(); } return; }
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
    if (st.empty) {
      const { moved, held, t0 } = st;
      clearHold();
      st = null;
      if (!moved && !held && Date.now() - t0 < TAP_MS) cbs.onSelect?.(null);
      return;
    }
    const { w, tile, moved, last, wasSelected, resize } = st;
    try { tile.releasePointerCapture(st.id); } catch { /* egal */ }
    tile.classList.remove('moving');
    hideGhost();
    const quick = Date.now() - st.t0 < TAP_MS;
    st = null;
    if (moved) {
      const page = cbs.getPage();
      cbs.onSnapshot?.(resize ? 'Groesse' : 'Verschieben');
      dropAt(page.widgets, page.columns, w, last);
      cbs.onChange();
    } else if (quick && wasSelected) {
      // Zweiter Tipp auf dieselbe Kachel: Einstellungen.
      cbs.onOpen(w);
    }
  };
  surface.addEventListener('pointerup', stop);
  surface.addEventListener('pointercancel', stop);
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
    // Ein leeres Feld ist kein Wert — sonst schnappt die Kachel beim Loeschen
    // der Zahl auf ihre Mindestgroesse, bevor die neue getippt ist.
    if (i.value.trim() === '' || i.value === '-') return;
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
  const row = el('div', 'row wrap swatches');
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

/** Welcher Reiter zuletzt offen war — je Bauteil gemerkt. */
let lastTab = { id: null, tab: 'allg' };

/**
 * Inspektor fuellen — in Reitern, damit nichts gescrollt werden muss.
 * @param {HTMLElement} body
 * @param {object} w
 * @param {object} page
 * @param {object} cbs { onChange(), onDelete(), onDuplicate() }
 */
export function buildInspector(body, w, page, cbs) {
  body.replaceChildren();
  // Die Fusszeile nennt den Typ. Die Groesse steht in der Kopfzeile des
  // Blattes — dort, wo man sie auch aendert.
  const note = el('p', 'note', TYPES[w.type].name);
  const change = () => cbs.onChange();
  const rebuild = () => { buildInspector(body, w, page, cbs); cbs.onChange(); cbs.onHead?.(); };

  const isKnobBank = w.type === 'bank' && w.bankMode === 'knob';
  const isValue = ['fader', 'knob', 'meter', 'xy'].includes(w.type) || isKnobBank;
  const isSwitch = ['toggle', 'button'].includes(w.type) || (w.type === 'bank' && !isKnobBank);
  const hasItems = ['bank', 'select'].includes(w.type);

  /* ------------------------------------------------------- Allgemein --- */
  const tabAllg = (panel) => {
    const name = field('Beschriftung', textInput(w.label, (v) => { w.label = v; change(); }));
    if (w.type === 'label') {
      panel.append(name);
    } else {
      // Nebeneinander: beides gehoert zusammen und passt in eine Zeile.
      const g = el('div', 'grid-na');
      g.append(name, field('OSC-Adresse', textInput(w.address, (v) => { w.address = v.trim(); change(); },
        { placeholder: '/surfaces/1/opacity' })));
      panel.append(g);
    }
    if (w.type === 'xy') {
      panel.append(field('Adresse Y (leer = beide Werte an die Adresse oben)',
        textInput(w.addressY, (v) => { w.addressY = v.trim(); change(); }, { placeholder: '/surfaces/1/position/y' })));
    }
    panel.append(el('span', 'fieldlabel', 'Farbe'), colorRow(w.color, (c) => { w.color = c; rebuild(); }));
  };

  /* ------------------------------------------------------------ Werte --- */
  const tabWert = (panel) => {
    if (isValue) {
      const g = el('div', 'grid2');
      g.append(field('Minimum', numInput(w.min, (v) => { w.min = v; change(); })),
               field('Maximum', numInput(w.max, (v) => { w.max = v; change(); })));
      panel.append(g);
    }
    if (isSwitch || (hasItems && !isKnobBank)) {
      const g = el('div', 'grid2');
      g.append(field('Wert „an"', numInput(w.onValue, (v) => { w.onValue = v; change(); })),
               field('Wert „aus"', numInput(w.offValue, (v) => { w.offValue = v; change(); })));
      panel.append(g);
    }
    if (w.type !== 'label' && w.type !== 'meter') {
      panel.append(field('Zahlentyp', selectInput(w.argType, [['f', 'Kommazahl (float)'], ['i', 'Ganzzahl (int)']],
        (v) => { w.argType = v; change(); })));
    }
    if (w.type === 'knob') {
      panel.append(checkbox('Endlos-Encoder (sendet Schritte ±1)', w.endless, (v) => { w.endless = v; rebuild(); }));
    }
    if (w.type === 'bank') {
      panel.append(field('Verhalten', selectInput(w.bankMode,
        [['momentary', 'Taster'], ['toggle', 'Schalter'], ['knob', 'Potis']],
        (v) => { w.bankMode = v; rebuild(); })));
    }
    if (w.type === 'meter') {
      panel.append(field('Anzeigen als', selectInput(w.source, [['number', 'Zahl mit Balken'], ['text', 'Text']],
        (v) => { w.source = v; rebuild(); })));
    }
    if (w.type === 'color') {
      panel.append(field('Bedienung', selectInput(w.colorMode, [
        ['rgb', 'Regler R/G/B + Deckkraft'],
        ['hsv', 'Regler H/S/V + Deckkraft'],
        ['palette', 'Palette + Deckkraft'],
      ], (v) => { w.colorMode = v; rebuild(); })));
    }
    if (w.type === 'label') {
      panel.append(field('Ausrichtung', selectInput(w.align, [['left', 'links'], ['center', 'mittig'], ['right', 'rechts']],
        (v) => { w.align = v; change(); })));
    }
    if (!panel.childElementCount) panel.append(el('p', 'note', 'Dieses Bauteil hat keine Werte.'));
  };

  /* -------------------------------------------------------- Eintraege --- */
  const tabItems = (panel) => {
    panel.append(field('Spalten im Feld (0 = automatisch)',
      numInput(w.cols, (v) => { w.cols = clamp(Math.round(v), 0, 12); rebuild(); }, { min: 0, max: 12, step: 1 })));
    panel.append(el('p', 'note', isKnobBank
      ? 'Jeder Eintrag ist ein Poti. Mit eigener Adresse sendet es dorthin, ohne Adresse an die Adresse des Bauteils.'
      : 'Mit eigener Adresse sendet der Eintrag „an"/„aus" dorthin. Ohne Adresse geht sein Wert an die Adresse des Bauteils.'));
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
      del.setAttribute('aria-label', 'Eintrag loeschen');
      del.addEventListener('click', () => { w.items.splice(i, 1); rebuild(); });
      row.append(del);
      list.append(row);
    });
    panel.append(list);
    const add = el('button', 'btn', 'Eintrag hinzufuegen');
    add.type = 'button';
    add.addEventListener('click', () => {
      // Der neue Eintrag zaehlt den vorigen hoch — Name, Adresse und Wert.
      const prev = w.items[w.items.length - 1];
      w.items.push(prev
        ? {
            label: bumpNumber(prev.label, ` ${w.items.length + 1}`),
            address: prev.address ? bumpNumber(prev.address, '2') : '',
            value: prev.value + 1,
          }
        : { label: '1', address: '', value: 1 });
      rebuild();
    });
    panel.append(add);
  };

  /* ---------------------------------------------------------- Palette --- */
  const tabPalette = (panel) => {
    panel.append(el('p', 'note', 'Diese Farben stehen im Bauteil zum Antippen bereit — in dieser Reihenfolge.'));
    const list = el('div', 'palrows');
    const colors = w.palette.length ? w.palette : defaultPalette();
    colors.forEach((hex, i) => {
      const row = el('div', 'palrow');
      const pick = el('input');
      pick.type = 'color';
      pick.value = hex;
      pick.setAttribute('aria-label', `Farbe ${i + 1}`);
      pick.addEventListener('input', () => {
        w.palette = [...colors];
        w.palette[i] = pick.value;
        change();
      });
      const del = el('button', 'iconbtn', '✕');
      del.type = 'button';
      del.setAttribute('aria-label', 'Farbe entfernen');
      del.addEventListener('click', () => {
        w.palette = colors.filter((_, k) => k !== i);
        rebuild();
      });
      row.append(pick, del);
      list.append(row);
    });
    panel.append(list);
    const row = el('div', 'row wrap');
    const add = el('button', 'btn', 'Farbe hinzufuegen');
    add.type = 'button';
    add.addEventListener('click', () => { w.palette = [...colors, '#ffffff']; rebuild(); });
    const reset = el('button', 'btn ghost', 'Grundfarben');
    reset.type = 'button';
    reset.addEventListener('click', () => { w.palette = []; rebuild(); });
    row.append(add, reset);
    panel.append(row);
  };

  const tabs = [
    { id: 'allg', name: 'Allgemein', build: tabAllg },
    { id: 'wert', name: 'Werte', build: tabWert },
    ...(hasItems ? [{ id: 'items', name: 'Eintraege', build: tabItems }] : []),
    ...(w.type === 'color' && w.colorMode === 'palette' ? [{ id: 'pal', name: 'Palette', build: tabPalette }] : []),
  ];

  if (lastTab.id !== w.id || !tabs.some((t) => t.id === lastTab.tab)) lastTab = { id: w.id, tab: 'allg' };

  const bar = el('div', 'tabs');
  bar.setAttribute('role', 'tablist');
  const panel = el('div', 'tabpanel');
  for (const t of tabs) {
    const b = el('button', 'tab' + (t.id === lastTab.tab ? ' on' : ''), t.name);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t.id === lastTab.tab));
    b.addEventListener('click', () => {
      lastTab = { id: w.id, tab: t.id };
      buildInspector(body, w, page, cbs);
    });
    bar.append(b);
  }
  body.append(bar, panel);
  (tabs.find((t) => t.id === lastTab.tab) || tabs[0]).build(panel);

  /* Duplizieren und Loeschen liegen immer griffbereit unter den Reitern. */
  const actions = el('div', 'row inspactions');
  const mk = (icon, label, cls, fn) => {
    const b = el('button', `btn ${cls}`);
    b.type = 'button';
    b.append(uiIcon(icon), el('span', null, label));
    b.addEventListener('click', fn);
    return b;
  };
  actions.append(
    mk('copy', 'Duplizieren', 'grow', () => cbs.onDuplicate()),
    mk('trash', 'Loeschen', 'danger', () => cbs.onDelete()),
  );
  body.append(actions);
  body.append(note);
}

/** Kopie eines Widgets — Beschriftung und Adressen zaehlen hoch. */
export const duplicateWidget = copyWidget;
