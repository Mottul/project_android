/** Stable, collision-free ids for documents, sources and marks. */
export function uid(prefix = ''): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${random}` : random
}

/**
 * A short, deterministic hash. Used to recognise the same file across sessions
 * even when it was added through a picker that hands out no persistent handle:
 * path, size and modification date together are specific enough in practice.
 */
export function fingerprint(...parts: (string | number)[]): string {
  const input = parts.join('|')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ code, 0x85ebca6b)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h1) + hex(h2)
}
