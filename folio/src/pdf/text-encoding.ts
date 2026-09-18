/**
 * Making text safe for a standard PDF font.
 *
 * The fourteen fonts every PDF reader is required to have are encoded with
 * WinAnsi, which is Latin-1 plus a handful of typographic characters. That
 * covers German, and the other Western European languages, completely — but a
 * document containing a Greek letter, a CJK character or an emoji will make the
 * encoder throw, and losing an entire export to one stray character is a bad
 * trade.
 *
 * So text is folded first: characters with a reasonable Latin equivalent are
 * substituted, and anything genuinely unrepresentable becomes a placeholder,
 * which the caller reports rather than swallows.
 *
 * Embedding a full Unicode font instead would avoid all of this. It would also
 * add a megabyte to an app whose point is that it works offline, for a case
 * that Folio's text editing — replacing a line in a Western-language document —
 * does not actually run into.
 *
 * Code points are written as numbers throughout. Several of the characters
 * involved are invisible or indistinguishable from a space, and a table of
 * those as literals is unreadable and unreviewable.
 */

/** Code points WinAnsiEncoding can represent beyond Latin-1. */
const EXTRA = new Set([
  0x20ac, // euro
  0x201a, 0x201e, // low quotes
  0x0192, // florin
  0x2026, // ellipsis
  0x2020, 0x2021, // daggers
  0x02c6, 0x02dc, // circumflex, small tilde
  0x2030, // per mille
  0x0160, 0x0161, 0x017d, 0x017e, 0x0178, // S/Z/Y with diacritics
  0x2039, 0x203a, // single angle quotes
  0x0152, 0x0153, // OE ligatures
  0x2018, 0x2019, 0x201c, 0x201d, // curly quotes
  0x2022, // bullet
  0x2013, 0x2014, // en and em dash
  0x2122, // trade mark
])

/** Characters worth keeping the meaning of rather than dropping. */
const FOLD = new Map<number, string>([
  [0x00a0, ' '], // no-break space
  [0x2007, ' '], // figure space
  [0x2009, ' '], // thin space
  [0x202f, ' '], // narrow no-break space
  [0x00ad, ''], // soft hyphen
  [0x200b, ''], // zero width space
  [0xfeff, ''], // byte order mark
  [0x2011, '-'], // non-breaking hyphen
  [0x2212, '-'], // minus sign
  [0x2032, "'"], // prime
  [0x2033, '"'], // double prime
  [0xfb00, 'ff'],
  [0xfb01, 'fi'],
  [0xfb02, 'fl'],
  [0xfb03, 'ffi'],
  [0xfb04, 'ffl'],
  [0x2044, '/'], // fraction slash
  [0x2248, '~'],
  [0x2260, '!='],
  [0x2264, '<='],
  [0x2265, '>='],
  [0x2192, '->'],
  [0x2190, '<-'],
  [0x21d2, '=>'],
  [0x2027, '.'], // hyphenation point
])

export interface EncodedText {
  text: string
  /** Characters that had no representation and were replaced by a question mark. */
  dropped: string[]
}

export function toWinAnsi(input: string): EncodedText {
  const dropped: string[] = []
  let out = ''

  for (const char of input) {
    const code = char.codePointAt(0) ?? 0

    if (char === '\n' || char === '\r') {
      out += char
      continue
    }
    if (char === '\t') {
      out += '    '
      continue
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += char
      continue
    }

    // The fold table is consulted before the Latin-1 range, not after it: a
    // no-break space and a soft hyphen both sit inside that range and would
    // otherwise pass through untouched — which is how an invisible character
    // ends up inside an exported line and splits a word at a size nobody chose.
    const folded = FOLD.get(code)
    if (folded !== undefined) {
      out += folded
      continue
    }

    if ((code >= 0xa0 && code <= 0xff) || EXTRA.has(code)) {
      out += char
      continue
    }

    // Letters carrying a combining mark: keep the base letter rather than lose
    // the word. "ẞ" and friends come out as plain ASCII, which reads fine.
    const stripped = char.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (stripped !== char && stripped.length > 0 && isAscii(stripped)) {
      out += stripped
      continue
    }

    dropped.push(char)
    out += '?'
  }

  return { text: out, dropped: [...new Set(dropped)] }
}

function isAscii(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

/** True when the string needs no folding at all — the common case. */
export function isWinAnsi(input: string): boolean {
  const { text, dropped } = toWinAnsi(input)
  return dropped.length === 0 && text === input
}

/**
 * Breaks text so it fits a given width.
 *
 * Used when replacement text is longer than the text it replaces: rather than
 * letting it run into the margin it wraps, and the replacement grows downwards
 * instead of sideways.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  widthOf: (line: string) => number,
): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('')
      continue
    }

    let line = ''
    for (const piece of paragraph.split(/(\s+)/)) {
      if (!piece) continue
      const candidate = line + piece

      // An over-long first word has nowhere to break to yet; it is handled by
      // breakWord below rather than by starting an empty line.
      if (widthOf(candidate) <= maxWidth || !line.trim()) {
        line = candidate
        continue
      }

      lines.push(line.trimEnd())
      line = piece.trimStart()
    }
    lines.push(line.trimEnd())
  }

  return lines.flatMap((line) =>
    widthOf(line) <= maxWidth ? [line] : breakWord(line, maxWidth, widthOf),
  )
}

function breakWord(word: string, maxWidth: number, widthOf: (line: string) => number): string[] {
  const parts: string[] = []
  let current = ''

  for (const char of word) {
    if (current && widthOf(current + char) > maxWidth) {
      parts.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}
