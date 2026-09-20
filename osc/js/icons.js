/**
 * Piktogramme der Bauteile — fuers Einfuegen-Raster und die Auswahl-Leiste.
 *
 * Nur das Innenleben eines 24x24-SVG. Gezeichnet wird mit `currentColor`,
 * Rahmen und Strichstaerke kommen aus dem Stylesheet (.pico svg).
 */

const FILL = 'fill="currentColor" stroke="none"';

export const TYPE_ICONS = {
  fader:
    '<rect x="9" y="3" width="6" height="18" rx="3"/>' +
    `<rect x="5.5" y="12" width="13" height="3.2" rx="1.6" ${FILL}/>`,
  knob:
    '<circle cx="12" cy="12" r="8"/>' +
    '<path d="M12 12V5.6"/>',
  toggle:
    '<rect x="2.5" y="7" width="19" height="10" rx="5"/>' +
    `<circle cx="16.5" cy="12" r="2.8" ${FILL}/>`,
  button:
    '<circle cx="12" cy="12" r="8.2"/>' +
    `<circle cx="12" cy="12" r="3.4" ${FILL}/>`,
  bank:
    '<rect x="3" y="3" width="8" height="8" rx="2"/>' +
    '<rect x="13" y="3" width="8" height="8" rx="2"/>' +
    '<rect x="3" y="13" width="8" height="8" rx="2"/>' +
    '<rect x="13" y="13" width="8" height="8" rx="2"/>',
  select:
    '<path d="M9 6.5h11M9 12h11M9 17.5h11"/>' +
    `<circle cx="4.5" cy="12" r="1.9" ${FILL}/>`,
  xy:
    '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
    '<path d="M3 15.5h18M8.5 3v18"/>' +
    `<circle cx="8.5" cy="15.5" r="2.4" ${FILL}/>`,
  color:
    '<path d="M12 3.2c3.6 4.1 6 7 6 9.6a6 6 0 0 1-12 0c0-2.6 2.4-5.5 6-9.6Z"/>',
  meter:
    '<path d="M3.5 18a8.5 8.5 0 0 1 17 0"/>' +
    '<path d="M12 18l4.2-4.8"/>',
  label:
    '<path d="M4.5 6.5h15M12 6.5v11"/>',
};

/** Fertiges SVG-Element fuer einen Bauteiltyp. */
export function typeIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = TYPE_ICONS[type] || TYPE_ICONS.label;
  return svg;
}

/** Kleines Schaltflaechen-Symbol (Duplizieren, Loeschen, Einstellungen). */
const UI_ICONS = {
  copy: '<rect x="8.5" y="3.5" width="12" height="12" rx="2.5"/><path d="M15.5 19.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.2h5v2.3M6.5 6.5 7.4 20a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-13.5"/>',
  undo: '<path d="M3.5 9h10a5.5 5.5 0 0 1 0 11H7"/><path d="M8 4.5 3.5 9 8 13.5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>',
};

export function uiIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = UI_ICONS[name] || '';
  return svg;
}
