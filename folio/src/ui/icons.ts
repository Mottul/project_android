/**
 * Icons.
 *
 * Inline SVG, one stroke weight, one grid. Inline rather than a sprite sheet or
 * an icon font because the interface is built imperatively anyway and an icon
 * here is just a string — no extra request, no font swap, no `<use>` that
 * breaks when the app moves to a different folder.
 */

const PATHS: Record<string, string> = {
  /* — Navigation — */
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14M5 12h14',

  /* — Library — */
  library: 'M4 4h5v16H4zM11 4h4v16h-4zM17.5 4.5l3 15',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v6M9 14h6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 12v6M9 15h6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 3v18',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  text: 'M5 5h14M5 10h14M5 15h9',

  /* — Reader — */
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6',
  fitWidth: 'M3 6v12M21 6v12M7 12h10M7 12l3-3M7 12l3 3M17 12l-3-3M17 12l-3 3',
  fitPage: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
  columns: 'M4 4h7v16H4zM13 4h7v16h-7z',
  scroll: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4',
  page: 'M7 3h10v18H7z',
  rotate: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  sidebar: 'M3 4h18v16H3zM9 4v16',
  contents: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',

  /* — Tools — */
  highlight: 'M4 20h16M6.5 16.5l8-8 3 3-8 8H6.5zM14 6.5l2-2a1.5 1.5 0 0 1 2 0l1.5 1.5a1.5 1.5 0 0 1 0 2l-2 2',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M5 20h14',
  strike: 'M4 12h16M7 8a4 3 0 0 1 4-3h2a4 3 0 0 1 4 3M7 16a4 3 0 0 0 4 3h2a4 3 0 0 0 4-3',
  pen: 'M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5z',
  eraser: 'M7 21h12M19 13l-6 6H8l-4-4a1.5 1.5 0 0 1 0-2l8-8a1.5 1.5 0 0 1 2 0l5 5a1.5 1.5 0 0 1 0 2z',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  textbox: 'M4 6V4h16v2M12 4v16M9 20h6',
  edit: 'M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z',
  redact: 'M4 8h16v8H4z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',

  /* — Output — */
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 14h8v7H8z',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  share: 'M4 12v8h16v-8M12 3v13M8 7l4-4 4 4',
  print: 'M7 9V3h10v6M7 17H4V9h16v8h-3M7 14h10v7H7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  warn: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  type: 'M4 6V4h16v2M12 4v16M9 20h6',
}

export type IconName = keyof typeof PATHS

/** Returns the SVG markup for an icon, sized in ems so it follows the text. */
export function icon(name: string, size = 20): string {
  const path = PATHS[name] ?? PATHS.info
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    path
      .split('M')
      .filter(Boolean)
      .map((segment) => `<path d="M${segment.trim()}"/>`)
      .join('') +
    `</svg>`
  )
}

/** An `<svg>` element rather than a string, for cases that need the node. */
export function iconElement(name: string, size = 20): SVGElement {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = icon(name, size)
  return wrapper.firstElementChild as SVGElement
}
