/**
 * Toasts, confirmations and prompts.
 *
 * Built on `<dialog>`, which brings the modal backdrop, focus trapping and the
 * Escape key with it. What is left is the part that actually differs between
 * apps: the wording, and making sure a question always has an answer — every
 * dialog here resolves, including when it is dismissed.
 */

import { clear, h } from '@/lib/dom'
import { icon } from './icons'

/* ===========================================================================
   Toasts
   ======================================================================== */

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

let toastHost: HTMLElement | null = null

function host(): HTMLElement {
  if (!toastHost) {
    toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' })
    document.body.appendChild(toastHost)
  }
  return toastHost
}

export interface ToastOptions {
  kind?: ToastKind
  /** Milliseconds. Errors stay until dismissed unless this says otherwise. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export function toast(message: string, options: ToastOptions = {}): () => void {
  const kind = options.kind ?? 'info'
  const duration = options.duration ?? (kind === 'error' ? 8000 : 3400)

  const element = h(
    `div.toast.toast-${kind}`,
    {},
    h('span.toast-icon', { html: icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warn', 18) }),
    h('span.toast-text', {}, message),
    options.action &&
      h(
        'button.toast-action',
        {
          type: 'button',
          onclick: () => {
            options.action?.onClick()
            dismiss()
          },
        },
        options.action.label,
      ),
    h('button.toast-close', {
      type: 'button',
      'aria-label': 'Schließen',
      html: icon('close', 16),
      onclick: () => dismiss(),
    }),
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const dismiss = () => {
    if (timer) clearTimeout(timer)
    element.classList.add('is-leaving')
    setTimeout(() => element.remove(), 180)
  }

  host().appendChild(element)
  if (duration > 0) timer = setTimeout(dismiss, duration)

  return dismiss
}

/** Long-running work with a progress bar; returns handles to drive it. */
export function progressToast(label: string) {
  const text = h('span.toast-text', {}, label)
  const bar = h('span.toast-bar-fill')
  const element = h(
    'div.toast.toast-progress',
    {},
    text,
    h('span.toast-bar', {}, bar),
  )
  host().appendChild(element)

  return {
    update(fraction: number, message?: string) {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
      if (message) text.textContent = message
    },
    done() {
      element.classList.add('is-leaving')
      setTimeout(() => element.remove(), 180)
    },
  }
}

/* ===========================================================================
   Dialogs
   ======================================================================== */

export interface DialogOptions {
  title: string
  /** Body content. A string is shown as a paragraph. */
  body?: string | Node
  confirmLabel?: string
  cancelLabel?: string
  /** Marks the confirm button as destructive. */
  danger?: boolean
  /** Hides the cancel button — an acknowledgement rather than a question. */
  acknowledge?: boolean
  width?: 'schmal' | 'breit'
}

export function showDialog(options: DialogOptions): Promise<boolean> {
  return openDialog(options).result
}

/**
 * Opens a dialog and hands back both its element and its result.
 *
 * Callers that build their own body — the export dialog, the settings panel —
 * need the element to put content into and a way to close it themselves.
 */
export function openDialog(options: DialogOptions): {
  dialog: HTMLDialogElement
  body: HTMLElement
  footer: HTMLElement
  result: Promise<boolean>
  close: (value: boolean) => void
} {
  const body = h('div.dialog-body')
  if (typeof options.body === 'string') body.appendChild(h('p', {}, options.body))
  else if (options.body) body.appendChild(options.body)

  const footer = h('div.dialog-footer')
  const dialog = h(`dialog.dialog.dialog-${options.width ?? 'schmal'}`, {},
    h('header.dialog-head', {},
      h('h2', {}, options.title),
      h('button.icon-button', {
        type: 'button',
        'aria-label': 'Schließen',
        html: icon('close', 18),
        onclick: () => close(false),
      }),
    ),
    body,
    footer,
  ) as HTMLDialogElement

  let settle: (value: boolean) => void = () => undefined
  const result = new Promise<boolean>((resolve) => {
    settle = resolve
  })

  let finished = false
  const close = (value: boolean) => {
    if (finished) return
    finished = true
    settle(value)
    dialog.close()
    dialog.remove()
  }

  if (!options.acknowledge) {
    footer.appendChild(
      h('button.button', { type: 'button', onclick: () => close(false) }, options.cancelLabel ?? 'Abbrechen'),
    )
  }
  footer.appendChild(
    h(
      `button.button.primary${options.danger ? '.danger' : ''}`,
      { type: 'button', onclick: () => close(true) },
      options.confirmLabel ?? 'OK',
    ),
  )

  // Escape and the backdrop both count as "no".
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close(false)
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close(false)
  })

  document.body.appendChild(dialog)
  dialog.showModal()

  return { dialog, body, footer, result, close }
}

export interface PromptOptions {
  title: string
  label: string
  value?: string
  placeholder?: string
  multiline?: boolean
  confirmLabel?: string
}

/** Asks for a line — or a paragraph — of text. Resolves to null on cancel. */
export async function promptText(options: PromptOptions): Promise<string | null> {
  const field = options.multiline
    ? (h('textarea.field', { rows: 5, placeholder: options.placeholder ?? '' }) as HTMLTextAreaElement)
    : (h('input.field', { type: 'text', placeholder: options.placeholder ?? '' }) as HTMLInputElement)
  field.value = options.value ?? ''

  const body = h('label.field-label', {}, h('span', {}, options.label), field)
  const { dialog, result, close } = openDialog({
    title: options.title,
    body,
    confirmLabel: options.confirmLabel ?? 'Übernehmen',
  })

  field.focus()
  field.select?.()

  // Enter submits a single-line field; a textarea keeps Enter for new lines and
  // takes Ctrl/Cmd+Enter instead.
  dialog.addEventListener('keydown', (event) => {
    const isEnter = (event as KeyboardEvent).key === 'Enter'
    if (!isEnter) return
    const modified = (event as KeyboardEvent).metaKey || (event as KeyboardEvent).ctrlKey
    if (options.multiline ? modified : true) {
      event.preventDefault()
      close(true)
    }
  })

  return (await result) ? field.value : null
}

/** A confirmation with a destructive default styling. */
export function confirmDestructive(
  title: string,
  body: string,
  confirmLabel: string,
): Promise<boolean> {
  return showDialog({ title, body, confirmLabel, danger: true })
}

/** Replaces the contents of a dialog body, for panels that switch views. */
export function replaceBody(body: HTMLElement, ...children: (Node | string)[]): void {
  clear(body)
  for (const child of children) {
    body.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}
