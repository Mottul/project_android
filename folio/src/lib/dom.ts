/**
 * DOM helpers.
 *
 * Folio builds its interface imperatively. That is a deliberate choice: the
 * reader is a canvas with several absolutely positioned overlays whose geometry
 * is recomputed on every zoom and every scroll, and a virtual DOM would only
 * get in the way of that. What it needs instead is a terse way to create
 * elements.
 */

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>
type Child = Node | string | number | null | undefined | false

/** `h('button.primary', { onclick }, 'Speichern')` */
export function h(selector: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const [tag, ...classes] = String(selector).split('.')
  const element = document.createElement(tag || 'div')
  if (classes.length) element.className = classes.join(' ')

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue

    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value as EventListener)
    } else if (name === 'class') {
      element.className = element.className ? `${element.className} ${value}` : String(value)
    } else if (name === 'html') {
      element.innerHTML = String(value)
    } else if (value === true) {
      element.setAttribute(name, '')
    } else {
      element.setAttribute(name, String(value))
    }
  }

  append(element, children)
  return element
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document) {
  return root.querySelector(selector) as T | null
}

/** Attaches a listener and hands back the function that removes it again. */
export function on(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): () => void {
  target.addEventListener(type, handler, options)
  return () => target.removeEventListener(type, handler, options)
}

/** Collapses bursts of calls into one, on the next animation frame. */
export function onFrame(fn: () => void): () => void {
  let queued = 0
  return () => {
    if (queued) return
    queued = requestAnimationFrame(() => {
      queued = 0
      fn()
    })
  }
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/** Triggers a download for a blob that was produced in memory. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = h('a', { href: url, download: filename }) as HTMLAnchorElement
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked late: Safari cancels the download if the URL dies too early.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
