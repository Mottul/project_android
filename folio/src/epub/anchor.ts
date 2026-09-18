/**
 * Anchoring a mark in reflowable text.
 *
 * A PDF page has fixed coordinates; an EPUB chapter does not. Font size, window
 * width and line height all change where a sentence sits, and none of them may
 * be allowed to move a highlight off the words it was put on. So an EPUB mark
 * does not store a position at all. It stores the text itself, plus a little of
 * what came before and after it — enough to tell two occurrences of the same
 * sentence apart — and is located again by searching.
 *
 * This is the text-quote selector from the W3C annotation model, and it has a
 * property no coordinate-based scheme has: it survives the book being re-styled,
 * re-paginated, or even lightly re-edited.
 */

export interface QuoteSelector {
  quote: string
  prefix?: string
  suffix?: string
}

export interface TextRange {
  start: number
  end: number
}

/** How much context is kept on each side. Long enough to disambiguate, short
 *  enough to survive an edited sentence nearby. */
export const CONTEXT_LENGTH = 32

export function makeSelector(text: string, start: number, end: number): QuoteSelector {
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH)),
  }
}

/**
 * Finds the selector in a chapter's text.
 *
 * Exact matches first, scored by how much of the surrounding context agrees.
 * When the quote does not appear verbatim — a whitespace change, a hyphen that
 * became an en dash — the search is retried against a whitespace-normalised
 * copy of the text, with the offsets mapped back.
 */
export function findQuote(text: string, selector: QuoteSelector): TextRange | null {
  const { quote } = selector
  if (!quote) return null

  const exact = bestMatch(text, quote, selector)
  if (exact) return exact

  const { normalised, map } = normaliseWithMap(text)
  const normalisedQuote = normaliseWhitespace(quote)
  const loose = bestMatch(normalised, normalisedQuote, {
    quote: normalisedQuote,
    prefix: selector.prefix ? normaliseWhitespace(selector.prefix) : undefined,
    suffix: selector.suffix ? normaliseWhitespace(selector.suffix) : undefined,
  })
  if (!loose) return null

  return {
    start: map[loose.start] ?? 0,
    // `map` holds the source offset of each normalised character; the end is
    // exclusive, so it maps through the last character that is included.
    end: (map[loose.end - 1] ?? text.length - 1) + 1,
  }
}

function bestMatch(text: string, quote: string, selector: QuoteSelector): TextRange | null {
  const positions: number[] = []
  let from = text.indexOf(quote)
  while (from !== -1 && positions.length < 200) {
    positions.push(from)
    from = text.indexOf(quote, from + 1)
  }
  if (!positions.length) return null
  if (positions.length === 1) return { start: positions[0], end: positions[0] + quote.length }

  let best = positions[0]
  let bestScore = -1
  for (const position of positions) {
    const score = contextScore(text, position, quote.length, selector)
    if (score > bestScore) {
      bestScore = score
      best = position
    }
  }
  return { start: best, end: best + quote.length }
}

/** Number of characters of context that match, counted inwards from the quote. */
function contextScore(
  text: string,
  position: number,
  length: number,
  selector: QuoteSelector,
): number {
  let score = 0

  if (selector.prefix) {
    const before = text.slice(Math.max(0, position - selector.prefix.length), position)
    score += commonSuffixLength(before, selector.prefix)
  }
  if (selector.suffix) {
    const after = text.slice(position + length, position + length + selector.suffix.length)
    score += commonPrefixLength(after, selector.suffix)
  }
  return score
}

export function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

export function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1
  return i
}

export function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Whitespace-normalised text plus, for every character in it, the offset it
 * came from. Leading whitespace is dropped, so the map is what makes the
 * offsets usable again afterwards.
 */
export function normaliseWithMap(text: string): { normalised: string; map: number[] } {
  let normalised = ''
  const map: number[] = []
  let pendingSpace = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (/\s/.test(char)) {
      pendingSpace = normalised.length > 0
      continue
    }
    if (pendingSpace) {
      normalised += ' '
      map.push(i)
      pendingSpace = false
    }
    normalised += char
    map.push(i)
  }

  return { normalised, map }
}

/* ===========================================================================
   Mapping offsets onto the DOM
   ======================================================================== */

/** Text nodes of a rendered chapter, in document order. */
export function textNodesOf(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode() as Text | null
  while (node) {
    nodes.push(node)
    node = walker.nextNode() as Text | null
  }
  return nodes
}

/** The chapter's text as one string — the same string the offsets refer to. */
export function textOf(root: Node): string {
  return textNodesOf(root)
    .map((node) => node.data)
    .join('')
}

/** Turns a character range over `textOf(root)` back into a DOM range. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const nodes = textNodesOf(root)
  let offset = 0
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const node of nodes) {
    const next = offset + node.data.length

    if (!startNode && start < next) {
      startNode = node
      startOffset = start - offset
    }
    if (end <= next) {
      endNode = node
      endOffset = end - offset
      break
    }
    offset = next
  }

  if (!startNode || !endNode) return null

  const range = document.createRange()
  range.setStart(startNode, Math.max(0, Math.min(startOffset, startNode.data.length)))
  range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.data.length)))
  return range
}

/**
 * The character range a DOM range covers, in `textOf(root)` coordinates.
 *
 * Measured by building a range from the start of the chapter to the start of
 * the selection and asking how long its text is. Walking the text nodes and
 * looking for the ones the selection names would be the obvious approach and is
 * wrong: a selection's boundary is frequently an *element* with a child index
 * rather than a text node with a character offset — which is what a double
 * click, a triple click and `selectNodeContents` all produce — and no text node
 * would ever match.
 */
export function offsetsOfRange(root: Node, range: Range): TextRange | null {
  try {
    const before = document.createRange()
    before.selectNodeContents(root)
    before.setEnd(range.startContainer, range.startOffset)

    const start = before.toString().length
    const end = start + range.toString().length
    return end > start ? { start, end } : null
  } catch {
    // The range starts outside the chapter; there is nothing to anchor to.
    return null
  }
}
