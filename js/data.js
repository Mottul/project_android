/**
 * Stammdaten: Panel-Bibliothek und Processor-Presets.
 *
 * Alle Werte sind praxisnahe Richtwerte fuer die Vorplanung und in der App
 * frei editierbar. Vor der Umsetzung immer gegen das Datenblatt des
 * tatsaechlich eingesetzten Materials pruefen.
 */

/** @typedef {{id:string,label:string,w:number,h:number,px:number,py:number,kg:number,pmax:number,pavg:number,chain:number}} Panel */

/** Panel-Bibliothek. w/h in mm, px/py in Pixel, kg pro Kabinett, pmax/pavg in Watt. */
export const PANELS = [
  { id: 'p1.9-500',  label: 'P1.9 · 500×500',        w: 500,  h: 500,  px: 256, py: 256, kg: 8.0,  pmax: 200, pavg: 65, chain: 8  },
  { id: 'p2.6-500',  label: 'P2.6 · 500×500',        w: 500,  h: 500,  px: 192, py: 192, kg: 7.5,  pmax: 180, pavg: 60, chain: 10 },
  { id: 'p2.6-1000', label: 'P2.6 · 500×1000',       w: 500,  h: 1000, px: 192, py: 384, kg: 14.5, pmax: 360, pavg: 120, chain: 5 },
  { id: 'p2.9-500',  label: 'P2.9 · 500×500',        w: 500,  h: 500,  px: 172, py: 172, kg: 7.2,  pmax: 170, pavg: 55, chain: 10 },
  { id: 'p3.9-500',  label: 'P3.9 · 500×500',        w: 500,  h: 500,  px: 128, py: 128, kg: 6.8,  pmax: 160, pavg: 50, chain: 12 },
  { id: 'p3.9-1000', label: 'P3.9 · 500×1000',       w: 500,  h: 1000, px: 128, py: 256, kg: 12.5, pmax: 320, pavg: 100, chain: 6 },
  { id: 'p4.8-500',  label: 'P4.8 · 500×500',        w: 500,  h: 500,  px: 104, py: 104, kg: 6.5,  pmax: 150, pavg: 48, chain: 14 },
  { id: 'p2.5-640',  label: 'P2.5 · 640×480',        w: 640,  h: 480,  px: 256, py: 192, kg: 8.5,  pmax: 200, pavg: 66, chain: 8  },
  { id: 'p3.0-960',  label: 'P3.0 · 960×960',        w: 960,  h: 960,  px: 320, py: 320, kg: 22.0, pmax: 620, pavg: 200, chain: 3 },
  { id: 'p10-960',   label: 'P10 · 960×960 (Outdoor)', w: 960, h: 960, px: 96,  py: 96,  kg: 26.0, pmax: 700, pavg: 230, chain: 3 },
  { id: 'custom',    label: 'Eigenes Panel …',       w: 500,  h: 500,  px: 168, py: 168, kg: 7.0,  pmax: 175, pavg: 58, chain: 8  },
];

/** @typedef {{id:string,label:string,ports:number,pxPort:number,pxTotal:number}} Processor */

/** Processor-Presets. pxPort = Pixel je Ausgang, pxTotal = Gesamtkapazitaet. */
export const PROCESSORS = [
  { id: 'gbe',      label: 'Generisch · 1 GbE Port',   ports: 4,  pxPort: 650000,  pxTotal: 2600000 },
  { id: 'gbe8',     label: 'Generisch · 8× 1 GbE',     ports: 8,  pxPort: 650000,  pxTotal: 5200000 },
  { id: 'gbe16',    label: 'Generisch · 16× 1 GbE',    ports: 16, pxPort: 650000,  pxTotal: 8800000 },
  { id: 'ten-gbe',  label: 'Generisch · 10 GbE Port',  ports: 4,  pxPort: 2600000, pxTotal: 9000000 },
  { id: 'custom-p', label: 'Eigener Processor …',      ports: 4,  pxPort: 650000,  pxTotal: 2600000 },
];

/** Farbpalette fuer Daten- und Stromgruppen (bewusst gut unterscheidbar). */
export const CHAIN_COLORS = [
  '#38bdf8', '#f97316', '#a3e635', '#e879f9', '#fbbf24', '#2dd4bf',
  '#fb7185', '#818cf8', '#4ade80', '#facc15', '#f472b6', '#60a5fa',
];

export const START_CORNERS = [
  { id: 'tl', label: 'oben links' },
  { id: 'tr', label: 'oben rechts' },
  { id: 'bl', label: 'unten links' },
  { id: 'br', label: 'unten rechts' },
];
