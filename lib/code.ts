// Code does not go on the whiteboard.
//
// It was drawn as one tldraw text shape per line inside a frame, which meant it
// inherited every constraint the canvas has and deserved none of them: it had to
// be measured in a handwriting font's metrics, it could not be selected or
// copied, it could not scroll, and it competed for panel width with the diagram
// it was explaining. A whiteboard is for named things and the arrows between
// them. Code is text, so it is rendered as text, in HTML, beside the board.
//
// It also comes straight from the teacher now rather than through the panel
// model, which removes a whole round-trip: the teacher already knows the code it
// is about to talk about.

export const MAX_CODE_COLS = 56
export const MAX_CODE_LINES = 14

export interface Snippet {
  id: string
  label: string
  /** Grows a line at a time as the snippet is revealed. */
  lines: string[]
}

/**
 * Normalises the lines a teacher emitted. Tabs become spaces so indentation
 * lines up in a mono font, and an over-long line is cut at the column rather
 * than at a word boundary — trimming `if (count > limit) {` to a word is worse
 * than trimming it to a column.
 */
export function cleanCodeLines(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const lines = value
    .filter((l): l is string => typeof l === "string")
    .slice(0, MAX_CODE_LINES)
    .map((l) => l.replace(/\t/g, "  ").trimEnd().slice(0, MAX_CODE_COLS))
  // Leading and trailing blank lines are padding, not code.
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.length ? lines : null
}
