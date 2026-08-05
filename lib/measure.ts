// Text metrics for tldraw's handwritten 'draw' font at size "s".
//
// Every box on the board is sized from these numbers, so being wrong here is not
// a cosmetic error. The previous version reserved space by character count and
// then let a box be squeezed to whatever width was left over, which is how a
// 65px box came to hold "svc A" as "sv / c / A". Nothing here ever squeezes: a
// label states the width it needs and the layout gives it that width.

// Checked against tldraw's own constants rather than eyeballed. A label at size
// "s" renders at LABEL_FONT_SIZES.s * 16 = 18px, and a geo shape reserves
// LABEL_PADDING = 16px on each side before its text may wrap. The widest
// character runs in this font measure ~12.4px at that size, so CHAR_W carries
// about 9% headroom over the worst case and PAD_X clears tldraw's 16 with room
// to spare. Being a few pixels short here is not a rounding error — it is the
// difference between "low memory" and "low / memor / y".
export const CHAR_W = 13.5
export const LINE_H = 26
/** Breathing room inside a labelled shape, per side. Must exceed tldraw's 16. */
export const PAD_X = 18
export const PAD_Y = 10

/** Labels are 1-4 words. This is the backstop for a model that ignores that. */
export const MAX_LABEL = 44

/** Past this width a label reads better wrapped than run out on one line. */
const ONE_LINE_MAX = 300

/** No label is worth more than this many lines; past it, shorten the text. */
const MAX_LINES = 2

/**
 * The most characters that fit on one line inside a shape this wide. Bare text
 * — a note, an annotation — has no shape around it, so it passes `pad = 0`.
 */
export function charsPerLine(width: number, pad = PAD_X): number {
  return Math.max(1, Math.floor((width - 2 * pad) / CHAR_W))
}

export function longestWord(text: string): number {
  return text.split(/\s+/).reduce((n, word) => Math.max(n, word.length), 0)
}

/**
 * Shortens a label without slicing through a word. A hard character cut leaves
 * "micro: urgen" on the board, which reads as a bug rather than a diagram.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

/** Breaks text into lines of at most `maxChars`, never mid-word. */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length) return [""]

  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    // A word longer than the line gets its own line and overflows rather than
    // being broken. Callers avoid that by never sizing a box below its longest
    // word — see `labelSize`.
    if (candidate.length <= maxChars || !line) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines
}

export interface Size {
  w: number
  h: number
}

/**
 * The smallest box that holds this label without breaking a word or running
 * past `MAX_LINES` lines.
 *
 * Width comes first and height follows from it. Growing height alone never
 * helps: a narrow box does not get shorter text, it wraps the text into a
 * column one character wide.
 */
export function labelSize(text: string): Size {
  if (!text) return { w: 0, h: 0 }

  // One line, if one line is not absurdly wide. Always splitting to MAX_LINES
  // made every short label a two-line box: "req 1" was sized for three
  // characters a line and came out as "req / 1", stacked, in a 96px column.
  const oneLine = Math.ceil(text.length * CHAR_W + 2 * PAD_X)
  if (oneLine <= ONE_LINE_MAX) {
    return { w: oneLine, h: LINE_H + 2 * PAD_Y }
  }

  // Otherwise aim for a line long enough to divide the label in two, but never
  // shorter than the longest word — a line too short for "Microtask" does not
  // move the word down, it snaps it into "Microtas / k".
  const perLine = Math.max(Math.ceil(text.length / MAX_LINES), longestWord(text))
  const w = Math.ceil(perLine * CHAR_W + 2 * PAD_X)
  return { w, h: labelHeight(text, w) }
}

/** How tall a label must be once its width is already decided. */
export function labelHeight(text: string, width: number): number {
  if (!text) return 0
  return wrap(text, charsPerLine(width)).length * LINE_H + 2 * PAD_Y
}
