import type { PanelShape } from "./shapes"

// Inside a panel, the same problem as across the board: the model is asked not
// to overlap, and sometimes overlaps anyway — especially within a single beat,
// where it is emitting several shapes at once and cannot see its own output.
//
// So the grid's lesson applies again. Ask for good placement, then *enforce* it:
// a shape that partially covers something already drawn is pushed down into the
// first clear space, and dropped if the panel has no room left.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** Whether this rect already carries a label. */
  labelled: boolean
}

// Metrics for tldraw's handwritten 'draw' font at size 's'. These were measured
// against what actually renders, not guessed: an earlier pass assumed ~8.5px per
// character, under-reserved every label by a third, and let the packer place the
// next shape straight through text it thought it had cleared.
const CHAR_W = 12.5
const LINE_H = 26
const PAD = 16

export const MAX_TEXT = 28

/** The most characters that will fit on one line of a box this wide. */
export function charsPerLine(width: number): number {
  return Math.max(1, Math.floor((width - PAD) / CHAR_W))
}

/**
 * Shortens a label to fit without slicing through a word. A hard character cut
 * leaves "micro: urgen" and "waits = stuc" on the board, which reads as a bug
 * rather than a diagram.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

export function textHeight(text: string, width: number): number {
  if (!text) return 0
  return Math.ceil(text.length / charsPerLine(width)) * LINE_H + PAD
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  )
}

// Nesting must be STRICT. With a merely-inclusive test, a shape drawn at exactly
// the coordinates of an existing one reads as "nested" and sails through — so a
// redrawn box lands pixel-perfect on top of the old one, which is the very
// duplicate-on-duplicate failure this is here to prevent.
const NEST_INSET = 4

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x + NEST_INSET &&
    inner.y >= outer.y + NEST_INSET &&
    inner.x + inner.w <= outer.x + outer.w - NEST_INSET &&
    inner.y + inner.h <= outer.y + outer.h - NEST_INSET
  )
}

/**
 * Is this placement acceptable against everything already drawn?
 *
 * Nesting is legal and load-bearing — the call stack is a box with frames drawn
 * *inside* it. So full containment either way is fine. What is never fine is a
 * partial overlap, or a bare label dropped on top of a box that is already
 * labelled: that is how "high prio" ends up written across "feeds tickets back".
 */
function acceptable(rect: Rect, isText: boolean, taken: Rect[]): boolean {
  for (const other of taken) {
    if (!intersects(rect, other)) continue
    if (isText) return false // a floating label may not touch anything
    if (contains(other, rect) || contains(rect, other)) continue // nesting
    return false
  }
  return true
}

export interface Packed {
  shape: PanelShape
  /** Everything this shape occupies — an arrow reserves its line AND its label. */
  rects: Rect[]
}

/** An arrow's label wraps to the arrow's own length, so it has to stay tiny. */
export const MAX_ARROW_TEXT = 10

function lineRect(shape: Extract<PanelShape, { kind: "arrow" }>): Rect {
  return {
    x: Math.min(shape.x, shape.x + shape.dx),
    y: Math.min(shape.y, shape.y + shape.dy),
    w: Math.abs(shape.dx) || 8,
    h: Math.abs(shape.dy) || 8,
    labelled: !!shape.text,
  }
}

/** Where an arrow's label actually sits: centred on the arrow's midpoint. */
function arrowLabelRect(
  shape: Extract<PanelShape, { kind: "arrow" }>,
  text: string,
): Rect {
  const w = Math.max(40, text.length * CHAR_W)
  return {
    x: shape.x + shape.dx / 2 - w / 2,
    y: shape.y + shape.dy / 2 - LINE_H / 2,
    w,
    h: LINE_H,
    labelled: true,
  }
}

/**
 * Everything a shape that has ALREADY been packed occupies. The client calls
 * this to remember what a panel holds; it must agree with what `pack` reserved,
 * or the two drift and the next beat starts overlapping again. Note an arrow
 * reserves two rects — its line and, when it kept one, its label.
 */
export function footprintsOf(shape: PanelShape): Rect[] {
  if (shape.kind === "text") {
    return [
      {
        x: shape.x,
        y: shape.y,
        w: Math.max(40, shape.text.length * CHAR_W),
        h: LINE_H,
        labelled: true,
      },
    ]
  }
  if (shape.kind === "arrow") {
    const rects = [lineRect(shape)]
    if (shape.text) rects.push(arrowLabelRect(shape, shape.text))
    return rects
  }
  return [
    {
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.h,
      labelled: !!shape.text,
    },
  ]
}

/**
 * Places one shape, sliding it downward past whatever blocks it. Returns null if
 * the panel is genuinely full — dropping a shape is better than drawing an
 * unreadable one on top of another.
 */
export function pack(
  shape: PanelShape,
  taken: Rect[],
  width: number,
  height: number,
): Packed | null {
  // An arrow points AT something; moving it destroys its meaning, so it stays
  // exactly where it was aimed. Its LABEL is another matter — that floats at the
  // midpoint and will happily print itself across whatever it crosses. So the
  // label is reserved like any other text, and if there is no room for it, the
  // label is dropped and the arrow drawn bare. A wordless arrow still reads; an
  // arrow whose label lies on top of a box reads as neither.
  if (shape.kind === "arrow") {
    const line = lineRect(shape)

    // ...but an arrow that runs the length of the panel, straight through
    // everything drawn in it, is not pointing at anything — it is a scratch
    // across the diagram. An arrow should join neighbours. If it gores more than
    // a couple of shapes on its way, it is doing something else, and it goes.
    const gored = taken.filter((t) => intersects(line, t)).length
    if (gored > 2) return null

    const text = truncate(shape.text, MAX_ARROW_TEXT)
    if (!text) return { shape: { ...shape, text: "" }, rects: [line] }

    const label = arrowLabelRect(shape, text)
    const fits =
      label.x >= 0 &&
      label.y >= 0 &&
      label.x + label.w <= width &&
      label.y + label.h <= height &&
      acceptable(label, true, taken)

    return fits
      ? { shape: { ...shape, text }, rects: [line, label] }
      : { shape: { ...shape, text: "" }, rects: [line] }
  }

  const isText = shape.kind === "text"

  let text: string
  let w: number
  let h: number
  if (isText) {
    // A standalone label does not wrap — it just runs off the panel. Cut it to
    // what the panel can actually hold.
    text = truncate(shape.text, Math.min(MAX_TEXT, charsPerLine(width)))
    w = Math.min(width - 8, Math.max(40, text.length * CHAR_W))
    h = LINE_H
  } else {
    text = truncate(shape.text, MAX_TEXT)
    // Text inside an ellipse only gets the inscribed area, not the full bounding
    // box — which is how a circle the model thought was ample rendered "stuck"
    // as "st / uc / k".
    const usable = shape.kind === "box" ? 1 : 0.7

    // Widen the shape until its label fits on at most two lines. Growing height
    // alone does not help: a narrow box just wraps the text into a column.
    //
    // And the box must be wide enough for its LONGEST WORD, not merely for the
    // average — a line too short for "Microtask" doesn't move the word to the
    // next line, it breaks it as "Microtas / k".
    const longest = text
      .split(/\s+/)
      .reduce((n, word) => Math.max(n, word.length), 0)
    const wantW = text
      ? Math.max(Math.ceil(text.length / 2), longest) * (CHAR_W / usable) + PAD
      : 0
    w = Math.min(Math.max(shape.w, wantW), width)

    // And it must be tall enough for whatever wrapping remains, or the text
    // spills out of the bottom.
    h = Math.min(Math.max(shape.h, textHeight(text, w * usable)), height)
  }

  const x = Math.max(0, Math.min(shape.x, width - w))
  let y = Math.max(0, Math.min(shape.y, height - h))

  let rect: Rect = { x, y, w, h, labelled: !!text }
  let guard = 0
  while (!acceptable(rect, isText, taken)) {
    // Jump to just below whatever we are colliding with, rather than crawling.
    const blocker = taken.find((o) => intersects(rect, o))
    if (!blocker || guard++ > 40) return null
    y = blocker.y + blocker.h + 10
    if (y + h > height) return null // no room left in this panel
    rect = { x, y, w, h, labelled: !!text }
  }

  const placed: PanelShape = isText
    ? { ...shape, kind: "text", x: rect.x, y: rect.y, text }
    : { ...shape, x: rect.x, y: rect.y, w: rect.w, h: rect.h, text }

  return { shape: placed, rects: [rect] }
}
