/**
 * Rechenkern: leitet aus dem Projekt-State alle Planungswerte ab.
 * Reine Funktionen ohne DOM-Zugriff, damit sie testbar bleiben.
 */

/** Kette = eine Daten- oder Stromleitung mit den daran haengenden Panels. */
/** @typedef {{index:number, cells:{c:number,r:number}[], px:number, watt:number}} Chain */

/**
 * Erzeugt die Reihenfolge, in der Panels durchgeschleift werden.
 * Bei `serpentine` wechselt jede zweite Spalte/Zeile die Richtung
 * (Schlangenlinie) — so bleiben die Bruecken zwischen den Panels kurz.
 */
export function scanOrder(cols, rows, { orientation = 'v', start = 'tl', serpentine = true } = {}) {
  const rightToLeft = start === 'tr' || start === 'br';
  const bottomToTop = start === 'bl' || start === 'br';
  const out = [];

  if (orientation === 'v') {
    for (let i = 0; i < cols; i++) {
      const c = rightToLeft ? cols - 1 - i : i;
      const flip = serpentine && i % 2 === 1;
      const upward = bottomToTop ? !flip : flip;
      for (let j = 0; j < rows; j++) out.push({ c, r: upward ? rows - 1 - j : j });
    }
  } else {
    for (let j = 0; j < rows; j++) {
      const r = bottomToTop ? rows - 1 - j : j;
      const flip = serpentine && j % 2 === 1;
      const leftward = rightToLeft ? !flip : flip;
      for (let i = 0; i < cols; i++) out.push({ c: leftward ? cols - 1 - i : i, r });
    }
  }
  return out;
}

/**
 * Teilt das Raster in Ketten mit hoechstens `budget` Panels.
 *
 * Passt eine ganze Spalte (bzw. Zeile) in das Budget, werden die Ketten an
 * Spalten-/Zeilengrenzen ausgerichtet und die Restspalten gleichmaessig
 * verteilt — so wie in der Praxis verkabelt wird. Sonst wird die
 * Scan-Reihenfolge fortlaufend geschnitten.
 */
export function buildChains(cols, rows, budget, opts = {}) {
  if (cols < 1 || rows < 1 || budget < 1) return [];
  const orientation = opts.orientation === 'h' ? 'h' : 'v';
  const span = orientation === 'v' ? rows : cols;
  const lines = orientation === 'v' ? cols : rows;
  const order = scanOrder(cols, rows, { ...opts, orientation });

  const sizes = [];
  if (budget >= span) {
    const perChain = Math.floor(budget / span);
    const groups = Math.ceil(lines / perChain);
    const base = Math.floor(lines / groups);
    const rest = lines % groups;
    for (let g = 0; g < groups; g++) sizes.push((base + (g < rest ? 1 : 0)) * span);
  } else {
    for (let i = 0; i < order.length; i += budget) sizes.push(Math.min(budget, order.length - i));
  }

  const chains = [];
  let cursor = 0;
  for (const size of sizes) {
    chains.push({ index: chains.length, cells: order.slice(cursor, cursor + size), px: 0, watt: 0 });
    cursor += size;
  }
  return chains;
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Leitet aus Panel + Raster + Signal- und Stromvorgaben alle Kennzahlen ab. */
export function computeAll(state) {
  const p = state.panel;
  const cols = Math.max(1, state.grid.cols | 0);
  const rows = Math.max(1, state.grid.rows | 0);
  const count = cols * rows;

  // --- Geometrie ---------------------------------------------------------
  const widthMm = cols * p.w;
  const heightMm = rows * p.h;
  const areaM2 = (widthMm / 1000) * (heightMm / 1000);
  const pitchW = p.w / p.px;
  const pitchH = p.h / p.py;
  const pitch = round((pitchW + pitchH) / 2, 2);
  const resW = cols * p.px;
  const resH = rows * p.py;
  const totalPx = resW * resH;
  const diagM = Math.hypot(widthMm, heightMm) / 1000;

  // --- Gewicht -----------------------------------------------------------
  const weight = count * p.kg;
  const weightPerCol = rows * p.kg;
  const weightPerM = widthMm > 0 ? weight / (widthMm / 1000) : 0;

  // --- Leistung ----------------------------------------------------------
  const pmax = count * p.pmax;
  const pavg = count * p.pavg;

  const volt = state.power.volt || 230;
  const breaker = state.power.breaker || 16;
  const derate = (state.power.derate || 80) / 100;
  const circuitW = volt * breaker * derate;
  const basisW = state.power.useAvg ? p.pavg : p.pmax;
  const autoPerCircuit = Math.max(1, Math.floor(circuitW / Math.max(1, basisW)));
  const perCircuit = state.power.manual ? Math.max(1, state.power.perCircuit | 0) : autoPerCircuit;

  const powerChains = buildChains(cols, rows, perCircuit, {
    orientation: state.power.orientation,
    start: state.power.start,
    serpentine: state.power.serpentine,
  });
  for (const ch of powerChains) ch.watt = ch.cells.length * basisW;

  const circuits = powerChains.length;
  const phases = state.power.phases === 3 ? 3 : 1;
  const ampsMax = pmax / (phases === 3 ? volt * 3 : volt);
  const ampsAvg = pavg / (phases === 3 ? volt * 3 : volt);
  const circuitsPerPhase = Math.ceil(circuits / phases);

  // --- Signal ------------------------------------------------------------
  const pxPanel = p.px * p.py;
  const pxPort = Math.max(1, state.signal.pxPort | 0);
  const budgetPx = Math.floor(pxPort / pxPanel);
  const chainLimit = Math.max(1, state.signal.maxChain | 0);
  const perPort = Math.max(1, Math.min(budgetPx, chainLimit));
  const portLimitedBy = budgetPx <= chainLimit ? 'Pixelbudget' : 'Daisy-Chain-Limit';

  const dataChains = buildChains(cols, rows, perPort, {
    orientation: state.signal.orientation,
    start: state.signal.start,
    serpentine: state.signal.serpentine,
  });
  for (const ch of dataChains) ch.px = ch.cells.length * pxPanel;

  const portsUsed = dataChains.length;
  const portsAvail = Math.max(1, state.signal.ports | 0);
  const redundancy = !!state.signal.redundancy;
  const portsNeeded = redundancy ? portsUsed * 2 : portsUsed;
  const processors = Math.max(
    Math.ceil(portsNeeded / portsAvail),
    Math.ceil(totalPx / Math.max(1, state.signal.pxTotal | 0))
  );
  const portLoad = dataChains.length ? Math.max(...dataChains.map((c) => c.px)) / pxPort : 0;

  // --- Optik -------------------------------------------------------------
  const distMin = round(pitch, 1);              // Faustregel: 1 mm Pitch ≈ 1 m
  const distComfort = round(pitch * 2.5, 1);
  const distRetina = round((pitch * 3438) / 1000, 1); // 1 px = 1 Bogenminute
  const fits = (w, h) => resW <= w && resH <= h;

  const maxCells = (list) => (list.length ? Math.max(...list.map((c) => c.cells.length)) : 0);

  return {
    cols, rows, count,
    widthMm, heightMm, areaM2: round(areaM2, 2), diagM: round(diagM, 2),
    diagInch: round((diagM * 1000) / 25.4, 0),
    pitch, pitchNonSquare: Math.abs(pitchW - pitchH) > 0.01,
    resW, resH, totalPx, mpx: round(totalPx / 1e6, 2),
    ratio: round(resW / resH, 3), ratioLabel: aspectLabel(resW, resH),
    fitsHD: fits(1920, 1080), fits4K: fits(3840, 2160),
    scaleHD: round(Math.min(1920 / resW, 1080 / resH), 2),
    scale4K: round(Math.min(3840 / resW, 2160 / resH), 2),
    weight: round(weight, 1), weightPerCol: round(weightPerCol, 1), weightPerM: round(weightPerM, 1),
    pmax: Math.round(pmax), pavg: Math.round(pavg),
    wPerM2Max: Math.round(areaM2 ? pmax / areaM2 : 0),
    wPerM2Avg: Math.round(areaM2 ? pavg / areaM2 : 0),
    circuitW: Math.round(circuitW), perCircuit, autoPerCircuit, basisW,
    circuits, phases, circuitsPerPhase, maxPerCircuit: maxCells(powerChains),
    ampsMax: round(ampsMax, 1), ampsAvg: round(ampsAvg, 1),
    powerChains,
    pxPanel, perPort, portLimitedBy, portsUsed, portsNeeded, portsAvail,
    processors, portLoad: round(portLoad * 100, 0), dataChains, maxPerPort: maxCells(dataChains),
    distMin, distComfort, distRetina,
  };
}

/** Kuerzt das Seitenverhaeltnis auf ganze Zahlen (z. B. 16:9). */
export function aspectLabel(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h) || 1;
  let a = w / g;
  let b = h / g;
  if (a > 40 || b > 40) {
    const f = Math.max(a, b) / 16;
    a = Math.round(a / f);
    b = Math.round(b / f);
    return `≈ ${a}:${b}`;
  }
  return `${a}:${b}`;
}
