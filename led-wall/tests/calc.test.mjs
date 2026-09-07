/** Tests fuer den Rechenkern: node --test tests/*.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanOrder, buildChains, computeAll, aspectLabel, fitInto, standardFeed } from '../js/calc.js';
import { MODULES, PROCESSORS, pxPortAt } from '../js/data.js';
import { migrate, parseDecimal } from '../js/state.js';

const CORNERS = ['tl', 'tr', 'bl', 'br'];

const project = (over = {}) => ({
  module: { ...MODULES.find((m) => m.id === 'us2plus') },
  grid: { cols: 12, rows: 6 },
  signal: { ports: 4, pxPort60: 650000, pxTotal: 2600000, hz: 60, maxChain: 10, orientation: 'v', start: 'tl', serpentine: true, redundancy: false },
  power: { volt: 230, breaker: 16, derate: 80, useAvg: false, manual: false, perCircuit: 8, phases: 3, orientation: 'v', start: 'tl', serpentine: true },
  ...over,
});

test('scanOrder besucht jedes Panel genau einmal', () => {
  for (const orientation of ['v', 'h']) {
    for (const start of CORNERS) {
      for (const serpentine of [true, false]) {
        const order = scanOrder(7, 4, { orientation, start, serpentine });
        const seen = new Set(order.map((c) => `${c.c},${c.r}`));
        assert.equal(order.length, 28, `${orientation}/${start}`);
        assert.equal(seen.size, 28, `${orientation}/${start} enthaelt Duplikate`);
      }
    }
  }
});

test('scanOrder startet in der gewaehlten Ecke', () => {
  const cases = { tl: { c: 0, r: 0 }, tr: { c: 6, r: 0 }, bl: { c: 0, r: 3 }, br: { c: 6, r: 3 } };
  for (const [start, expected] of Object.entries(cases)) {
    assert.deepEqual(scanOrder(7, 4, { orientation: 'v', start })[0], expected, start);
    assert.deepEqual(scanOrder(7, 4, { orientation: 'h', start })[0], expected, start);
  }
});

test('scanOrder laeuft in Schlangenlinie zurueck', () => {
  const order = scanOrder(2, 3, { orientation: 'v', start: 'tl', serpentine: true });
  assert.deepEqual(order.map((c) => `${c.c}${c.r}`), ['00', '01', '02', '12', '11', '10']);
  const straight = scanOrder(2, 3, { orientation: 'v', start: 'tl', serpentine: false });
  assert.deepEqual(straight.map((c) => `${c.c}${c.r}`), ['00', '01', '02', '10', '11', '12']);
});

test('buildChains deckt alle Panels ab und haelt das Budget ein', () => {
  for (const [cols, rows, budget] of [[12, 6, 10], [12, 6, 6], [5, 6, 4], [9, 4, 40], [1, 1, 1], [13, 7, 15]]) {
    const chains = buildChains(cols, rows, budget, { orientation: 'v', start: 'tl', serpentine: true });
    const all = chains.flatMap((ch) => ch.cells.map((c) => `${c.c},${c.r}`));
    assert.equal(all.length, cols * rows, `${cols}x${rows}/${budget}: Panelanzahl`);
    assert.equal(new Set(all).size, cols * rows, `${cols}x${rows}/${budget}: Duplikate`);
    for (const ch of chains) assert.ok(ch.cells.length <= budget, `${cols}x${rows}/${budget}: Kette zu lang`);
  }
});

test('buildChains richtet Ketten an Spalten aus, wenn das Budget reicht', () => {
  const chains = buildChains(12, 6, 13, { orientation: 'v', start: 'tl', serpentine: true });
  assert.equal(chains.length, 6);
  for (const ch of chains) {
    assert.equal(ch.cells.length, 12); // zwei volle Spalten
    assert.equal(new Set(ch.cells.map((c) => c.c)).size, 2);
  }
});

test('buildChains verteilt Restspalten gleichmaessig', () => {
  // 10 Spalten, Budget fuer 4 Spalten -> 3 Ketten mit 4/3/3 statt 4/4/2
  const chains = buildChains(10, 4, 16, { orientation: 'v', start: 'tl' });
  assert.deepEqual(chains.map((ch) => ch.cells.length / 4), [4, 3, 3]);
});

test('Geometrie und Gewicht', () => {
  const c = computeAll(project());
  assert.equal(c.widthMm, 6000);
  assert.equal(c.heightMm, 3000);
  assert.equal(c.resW, 2304);
  assert.equal(c.resH, 1152);
  assert.equal(c.count, 72);
  assert.equal(c.pitch, 2.6);
  assert.equal(c.areaM2, 18);
  assert.equal(c.weight, 612);        // 72 × 8,5 kg
  assert.equal(c.weightPerM, 102);
  assert.equal(c.ratioLabel, '2:1');
  assert.equal(c.fits4K, true);
  assert.equal(c.fitsHD, false);
});

test('Stromkreise folgen der Belastbarkeit', () => {
  const c = computeAll(project());
  assert.equal(c.circuitW, 2944);            // 230 V * 16 A * 80 %
  assert.equal(c.autoPerCircuit, 16);        // 2944 W / 180 W je Modul
  assert.equal(c.maxPerCircuit, 12);         // zwei volle Spalten a 6 Panels
  assert.equal(c.circuits, 6);
  assert.equal(c.pmax, 12960);
  assert.equal(c.ampsMax, 18.8);             // dreiphasig
  assert.equal(c.feed, 'CEE 32 A, 5-polig');
});

test('Einspeisung waehlt den naechstgroesseren Standardanschluss', () => {
  assert.equal(standardFeed(10, 3), 'CEE 16 A, 5-polig');
  assert.equal(standardFeed(13, 3), 'CEE 32 A, 5-polig');
  assert.equal(standardFeed(30, 1), '63 A einphasig');
  assert.match(standardFeed(200, 3), /Sonderverteilung/);
});

test('Signalwege folgen Pixelbudget und Kettenlimit', () => {
  const c = computeAll(project());
  assert.equal(c.pxPanel, 36864);
  assert.equal(c.perPort, 10);               // Kettenlimit greift vor dem Pixelbudget
  assert.equal(c.portLimitedBy, 'Daisy-Chain-Limit');
  assert.equal(c.portsUsed, 12);
  assert.equal(c.processors, 3);             // 12 Ports auf Geraeten mit 4 Ports

  const big = computeAll(project({ signal: { ...project().signal, maxChain: 40 } }));
  assert.equal(big.perPort, 17);             // 650.000 px / 36.864 px
  assert.equal(big.portLimitedBy, 'Pixelbudget');
});

test('Redundanz verdoppelt die Portanzahl', () => {
  const base = project();
  const c = computeAll(project({ signal: { ...base.signal, redundancy: true } }));
  assert.equal(c.portsNeeded, c.portsUsed * 2);
});

test('Pixelbudget je Port skaliert mit der Bildrate', () => {
  assert.equal(pxPortAt(650000, 60), 650000);
  assert.equal(pxPortAt(650000, 30), 1300000);
  assert.equal(pxPortAt(650000, 120), 325000);
  const slow = computeAll(project({ signal: { ...project().signal, hz: 30, maxChain: 40 } }));
  assert.equal(slow.pxPort, 1300000);
  assert.equal(slow.perPort, 35);            // 1.300.000 px / 36.864 px je Modul
});

test('Einpassung in 16:9 beziffert die Raender', () => {
  const wide = fitInto(2304, 1152, 1920, 1080);
  assert.equal(wide.mode, 'letterbox');
  assert.equal(wide.barY, 60);
  assert.equal(wide.barX, 0);
  const tall = fitInto(1536, 1536, 1920, 1080);
  assert.equal(tall.mode, 'pillarbox');
  assert.equal(tall.barX, 420);
  assert.equal(fitInto(1920, 1080, 1920, 1080).mode, 'exact');
  assert.equal(fitInto(1920, 1080, 1920, 1080).usedPct, 100);
});

test('Projekte aus Version 1 werden uebernommen', () => {
  const old = {
    name: 'Altes Projekt',
    panelId: 'p2.6-500',
    panel: { label: 'P2.6', w: 500, h: 500, px: 192, py: 192, kg: 7.5, pmax: 180, pavg: 60 },
    grid: { cols: 8, rows: 4 },
    signal: { ports: 4, pxPort: 650000, pxTotal: 2600000, maxChain: 10 },
  };
  const s = migrate(old);
  assert.equal(s.moduleId, 'custom');        // unbekanntes Preset wird eigenes Modul
  assert.equal(s.module.w, 500);
  assert.equal(s.signal.pxPort60, 650000);
  assert.equal(s.signal.pxPort, undefined);
  assert.equal(s.signal.hz, 60);
  assert.equal(s.size.w, 4);                 // 8 × 500 mm
  assert.ok(s.module.d > 0);                 // Tiefe aus den Defaults
});

test('Modulbibliothek passt zur Modulliste', () => {
  const ids = MODULES.map((m) => m.id);
  assert.deepEqual(ids, ['m496-20', 'us2plus', 'rx3iobf', 'custom']);
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));
  assert.equal((byId['m496-20'].w / byId['m496-20'].px).toFixed(2), '2.07');
  assert.equal((byId.us2plus.w / byId.us2plus.px).toFixed(2), '2.60');
  assert.equal((byId.rx3iobf.w / byId.rx3iobf.px).toFixed(3), '3.906');
  assert.deepEqual(PROCESSORS.map((p) => p.id), ['novapro-uhd-jr', 'vx4s', 'tessera-s8', 'custom-p']);
});

test('Dezimaleingabe akzeptiert Komma und Punkt', () => {
  assert.equal(parseDecimal('6,25'), 6.25);
  assert.equal(parseDecimal('6.25'), 6.25);
  assert.ok(Number.isNaN(parseDecimal('abc')));
});

test('Betrachtungsabstaende folgen dem Pixelabstand', () => {
  const c = computeAll(project());
  assert.equal(c.distMin, 2.6);
  assert.equal(c.distComfort, 6.5);
  assert.equal(c.distRetina, 8.9);
});

test('aspectLabel kuerzt korrekt', () => {
  assert.equal(aspectLabel(1920, 1080), '16:9');
  assert.equal(aspectLabel(2304, 1152), '2:1');
  assert.equal(aspectLabel(1000, 999).startsWith('≈'), true);
});
