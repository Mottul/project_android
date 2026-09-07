/**
 * Stammdaten: Modultypen, Processor-Presets, Bildraten.
 *
 * Die drei Modultypen stammen aus der Modulliste des Fuhrparks. Die
 * Processor-Werte sind Richtwerte fuer die Vorplanung und in der App frei
 * editierbar — vor der Umsetzung gegen das Datenblatt pruefen.
 */

/** @typedef {{id:string,label:string,w:number,h:number,d:number,px:number,py:number,kg:number,pmax:number,pavg:number,chain:number,note:string}} Module */

/**
 * Modulbibliothek. w/h/d in mm, px/py in Pixel, kg je Modul,
 * pavg/pmax in Watt (Durchschnitt / Maximum), chain = Module je Daisy-Chain.
 */
export const MODULES = [
  {
    id: 'm496-20',
    label: '496-2,0 (Standard)',
    w: 496, h: 496, d: 55,
    px: 240, py: 240,
    kg: 7.5, pavg: 80, pmax: 180,
    chain: 8,
    note: 'IP40, Indoor Fine-Pitch',
  },
  {
    id: 'us2plus',
    label: 'uS2+',
    w: 500, h: 500, d: 80,
    px: 192, py: 192,
    kg: 8.5, pavg: 60, pmax: 180,
    chain: 10,
    note: 'IP20, curvebar (±45°, min. R 0,637 m)',
  },
  {
    id: 'rx3iobf',
    label: 'rX3ioBF',
    w: 500, h: 500, d: 100,
    px: 128, py: 128,
    kg: 9.7, pavg: 80, pmax: 190,
    chain: 12,
    note: 'IP65 Outdoor, 5000 nit',
  },
  {
    id: 'custom',
    label: 'Eigenes Modul',
    w: 500, h: 500, d: 80,
    px: 168, py: 168,
    kg: 8.0, pavg: 70, pmax: 180,
    chain: 8,
    note: 'Frei konfigurierbar',
  },
];

/** @typedef {{id:string,label:string,ports:number,pxPort60:number,pxTotal:number,note:string}} Processor */

/**
 * Processor-Presets. `pxPort60` = Pixel je Ethernet-Port bei 60 Hz und 8 bit,
 * `pxTotal` = Gesamtkapazitaet des Geraets.
 */
export const PROCESSORS = [
  {
    id: 'novapro-uhd-jr',
    label: 'NovaPro UHD Jr',
    ports: 4, pxPort60: 650000, pxTotal: 2600000,
    note: '4 × Gigabit (opt. Glasfaser), 4K-Eingang',
  },
  {
    id: 'vx4s',
    label: 'NovaStar VX4S',
    ports: 4, pxPort60: 650000, pxTotal: 1300000,
    note: 'Gesamtkapazität 1,3 Mpx, max. 3840 px breit',
  },
  {
    id: 'tessera-s8',
    label: 'Brompton Tessera S8',
    ports: 8, pxPort60: 650000, pxTotal: 4600000,
    note: '8 × Gigabit, Gesamtkapazität 4,6 Mpx',
  },
  {
    id: 'custom-p',
    label: 'Eigener Processor',
    ports: 4, pxPort60: 650000, pxTotal: 2600000,
    note: 'Frei konfigurierbar',
  },
];

/**
 * Bildraten. Ein Gigabit-Port traegt bei 8 bit rund 650.000 px bei 60 Hz;
 * die Datenrate skaliert linear mit der Bildrate.
 */
export const REFRESH_RATES = [24, 25, 30, 50, 60, 100, 120];

/** Pixel je Port bei abweichender Bildrate (Basis: Wert bei 60 Hz). */
export const pxPortAt = (pxPort60, hz) => Math.floor((pxPort60 * 60) / (hz || 60));

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
