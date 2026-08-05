import type { Block, Item, Side } from "./blocks"
import type { Color, PanelShape } from "./shapes"
import {
  CHAR_W,
  LINE_H,
  charsPerLine,
  labelHeight,
  labelSize,
  truncate,
  type Size,
} from "./measure"

// Blocks in, placed shapes out. Pure, deterministic, and the only thing in the
// codebase that chooses a coordinate.
//
// Every decision the old panel prompt asked the model to make lives here as
// arithmetic: whether a chain reads better across or down, how wide a box has to
// be for its own label, where a row wraps. None of it can go wrong at runtime,
// because none of it is a judgement call any more.

const GAP = 18
/** Centre-to-centre run of a flow arrow, including the gap on both sides. */
const ARROW_LEN = 48
const ARROW_INSET = 8
const MIN_BOX_W = 96
const MIN_BOX_H = 46
const STACK_PAD = 14
const STACK_GAP = 10
const HEADING_H = LINE_H + 6

export const BLOCK_GAP = 30
export const PANEL_PAD = 22
export const MIN_PANEL_W = 260
export const MAX_PANEL_W = 1040
export const MIN_PANEL_H = 150

/** Blocks flow into the next column rather than past this height. */
const MAX_COL_H = 520
const COL_GAP = 32

/**
 * A column is capped so that TWO of them always fit inside a panel at its full
 * width. Without this, one wide block set the shared column width for the whole
 * panel and no second column could ever fit beside it — so a panel holding a
 * five-item row plus four other blocks went back to being a 900px strip.
 *
 * The cap is generous enough to keep a three-item flow horizontal, which is the
 * layout worth protecting: it is the one that reads at a glance.
 */
const MAX_COL_W = Math.floor((MAX_PANEL_W - 2 * PANEL_PAD - COL_GAP) / 2)

export interface Rendered {
  shapes: PanelShape[]
  w: number
  h: number
}

function itemSize(item: Item): Size {
  const size = labelSize(item.text)
  return { w: Math.max(MIN_BOX_W, size.w), h: Math.max(MIN_BOX_H, size.h) }
}

function boxAt(item: Item, x: number, y: number, w: number, h: number): PanelShape {
  return {
    kind: "box",
    x,
    y,
    w,
    h,
    text: item.text,
    color: item.color,
    // The one thing the current sentence is about gets filled in. It is the only
    // emphasis the board has, so it stays scarce.
    fill: item.emphasis ? "semi" : "none",
  }
}

function heading(text: string, x: number, y: number): PanelShape {
  return { kind: "text", x, y, text, color: "grey" }
}

function shift(shapes: PanelShape[], dx: number, dy: number): PanelShape[] {
  return shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }))
}

function snap(shape: PanelShape): PanelShape {
  return { ...shape, x: Math.round(shape.x), y: Math.round(shape.y) }
}

// —— rows, wrapped ————————————————————————————————————————————————————

interface Line {
  items: number[]
  w: number
  h: number
}

/** Greedily fills lines of at most `avail` width, the way flex-wrap does. */
function intoLines(sizes: Size[], avail: number): Line[] {
  const lines: Line[] = []
  let current: Line = { items: [], w: 0, h: 0 }

  sizes.forEach((size, i) => {
    if (current.items.length && current.w + GAP + size.w > avail) {
      lines.push(current)
      current = { items: [], w: 0, h: 0 }
    }
    current.w += current.items.length ? GAP + size.w : size.w
    current.h = Math.max(current.h, size.h)
    current.items.push(i)
  })
  if (current.items.length) lines.push(current)
  return lines
}

/** Lays out wrapped lines, centring each and levelling the boxes within it. */
function renderLines(items: Item[], sizes: Size[], lines: Line[]): Rendered {
  const w = Math.max(...lines.map((l) => l.w))
  const shapes: PanelShape[] = []
  let y = 0

  for (const line of lines) {
    let x = (w - line.w) / 2
    for (const i of line.items) {
      // Boxes on the same line share a height. Ragged tops read as a mistake.
      shapes.push(boxAt(items[i], x, y, sizes[i].w, line.h))
      x += sizes[i].w + GAP
    }
    y += line.h + GAP
  }

  return { shapes, w, h: y - GAP }
}

// —— the block kinds ——————————————————————————————————————————————————

/**
 * A → B → C. Reads across if it fits, and downward if it doesn't.
 *
 * This is the decision that used to be the model's, and it is exactly the kind
 * it cannot make: it does not know how wide "memory maxed" renders, so it laid
 * three boxes across a 201px panel and got three characters per line.
 */
function renderFlow(items: Item[], avail: number): Rendered {
  const sizes = items.map(itemSize)
  const across =
    sizes.reduce((n, s) => n + s.w, 0) + ARROW_LEN * (items.length - 1)

  if (across <= avail) {
    const h = Math.max(...sizes.map((s) => s.h))
    const shapes: PanelShape[] = []
    let x = 0
    items.forEach((item, i) => {
      shapes.push(boxAt(item, x, 0, sizes[i].w, h))
      x += sizes[i].w
      if (i < items.length - 1) {
        shapes.push({
          kind: "arrow",
          x: x + ARROW_INSET,
          y: h / 2,
          dx: ARROW_LEN - 2 * ARROW_INSET,
          dy: 0,
          color: "black",
        })
        x += ARROW_LEN
      }
    })
    return { shapes, w: across, h }
  }

  const w = Math.min(Math.max(...sizes.map((s) => s.w)), avail)
  const shapes: PanelShape[] = []
  let y = 0
  items.forEach((item, i) => {
    const h = Math.max(MIN_BOX_H, labelHeight(item.text, w))
    shapes.push(boxAt(item, 0, y, w, h))
    y += h
    if (i < items.length - 1) {
      shapes.push({
        kind: "arrow",
        x: w / 2,
        y: y + ARROW_INSET,
        dx: 0,
        dy: ARROW_LEN - 2 * ARROW_INSET,
        color: "black",
      })
      y += ARROW_LEN
    }
  })
  return { shapes, w, h: y }
}

/**
 * A column of boxes at a fixed width, top to bottom.
 *
 * Both a stack's contents and one side of a comparison are this, and having it
 * written twice meant the container height in `renderStack` had to be kept in
 * step by hand with a loop in `renderCompare` that already disagreed about how
 * to compute it.
 */
function stackedBoxes(
  items: Item[],
  x: number,
  top: number,
  w: number,
): { shapes: PanelShape[]; h: number } {
  const shapes: PanelShape[] = []
  let y = top
  for (const item of items) {
    const h = Math.max(MIN_BOX_H, labelHeight(item.text, w))
    shapes.push(boxAt(item, x, y, w, h))
    y += h + STACK_GAP
  }
  return { shapes, h: y - STACK_GAP - top }
}

/** A container with things inside it — a stack, a queue, a bucket. */
function renderStack(
  label: string | undefined,
  items: Item[],
  avail: number,
): Rendered {
  // `itemSize` has already floored each width at MIN_BOX_W, so flooring the
  // maximum again only suggests it might not have.
  const inner = Math.min(
    Math.max(...items.map((i) => itemSize(i).w)),
    avail - 2 * STACK_PAD,
  )
  const labelH = label ? HEADING_H : 0
  const stacked = stackedBoxes(items, STACK_PAD, labelH + STACK_PAD, inner)
  const containerH = stacked.h + 2 * STACK_PAD

  const shapes: PanelShape[] = []
  if (label) shapes.push(heading(label, 0, 0))
  // The container is drawn first: it is the thing the items go into, so it
  // should be on the board before they arrive.
  shapes.push({
    kind: "box",
    x: 0,
    y: labelH,
    w: inner + 2 * STACK_PAD,
    h: containerH,
    text: "",
    color: "grey",
    fill: "none",
  })
  shapes.push(...stacked.shapes)

  return { shapes, w: inner + 2 * STACK_PAD, h: labelH + containerH }
}

/** Two columns set against each other — with and without, before and after. */
function renderCompare(left: Side, right: Side, avail: number): Rendered {
  const colW = Math.max(MIN_BOX_W, Math.floor((avail - 2 * GAP) / 2))

  const column = (side: Side, x: number) => {
    const stacked = stackedBoxes(side.items, x, HEADING_H, colW)
    return {
      shapes: [heading(side.label, x, 0), ...stacked.shapes],
      h: HEADING_H + stacked.h,
    }
  }

  const l = column(left, 0)
  const r = column(right, colW + 2 * GAP)
  return {
    shapes: [...l.shapes, ...r.shapes],
    w: 2 * colW + 2 * GAP,
    h: Math.max(l.h, r.h),
  }
}

/** One thing above the several it fans out to. */
function renderTree(root: Item, children: Item[], avail: number): Rendered {
  const sizes = children.map(itemSize)
  const lines = intoLines(sizes, avail)
  const kids = renderLines(children, sizes, lines)
  const rootSize = itemSize(root)

  const w = Math.max(rootSize.w, kids.w)
  const kidsX = (w - kids.w) / 2
  const kidsY = rootSize.h + ARROW_LEN

  const shapes: PanelShape[] = [boxAt(root, (w - rootSize.w) / 2, 0, rootSize.w, rootSize.h)]
  shapes.push(...shift(kids.shapes, kidsX, kidsY))

  // Arrows come last so they never point at a box that hasn't appeared yet.
  // Only the first row is joined — a wrapped second row is already understood
  // as more of the same, and fanning arrows down to it crosses the first.
  let x = kidsX + (kids.w - lines[0].w) / 2
  for (const i of lines[0].items) {
    const centre = x + sizes[i].w / 2
    shapes.push({
      kind: "arrow",
      x: w / 2,
      y: rootSize.h + ARROW_INSET,
      dx: centre - w / 2,
      dy: ARROW_LEN - 2 * ARROW_INSET,
      color: "black",
    })
    x += sizes[i].w + GAP
  }

  return { shapes, w, h: kidsY + kids.h }
}

function renderNote(text: string, color: Color, avail: number): Rendered {
  // A note is bare text with no shape around it, so it gets the full width.
  const fitted = truncate(text, charsPerLine(avail, 0))
  return {
    shapes: [{ kind: "text", x: 0, y: 0, text: fitted, color }],
    w: Math.ceil(fitted.length * CHAR_W),
    h: LINE_H,
  }
}

export function renderBlock(block: Block, avail: number): Rendered {
  switch (block.kind) {
    case "flow":
      return renderFlow(block.items, avail)
    case "row": {
      const sizes = block.items.map(itemSize)
      return renderLines(block.items, sizes, intoLines(sizes, avail))
    }
    case "stack":
      return renderStack(block.label, block.items, avail)
    case "compare":
      return renderCompare(block.left, block.right, avail)
    case "tree":
      return renderTree(block.root, block.children, avail)
    case "note":
      return renderNote(block.text, block.color, avail)
  }
}

/** The width a block would take with unlimited room — what the panel asks for. */
function naturalWidth(block: Block): number {
  const total = (items: Item[], gap: number) =>
    items.reduce((n, i) => n + itemSize(i).w, 0) + gap * (items.length - 1)

  switch (block.kind) {
    case "flow":
      return total(block.items, ARROW_LEN)
    case "row":
      return total(block.items, GAP)
    case "stack":
      return Math.max(...block.items.map((i) => itemSize(i).w)) + 2 * STACK_PAD
    case "compare": {
      const widest = Math.max(
        ...[...block.left.items, ...block.right.items].map((i) => itemSize(i).w),
      )
      return 2 * widest + 2 * GAP
    }
    case "tree":
      return Math.max(itemSize(block.root).w, total(block.children, GAP))
    case "note":
      return Math.ceil(block.text.length * CHAR_W)
  }
}

export interface PanelRender {
  shapes: PanelShape[]
  /** Index into `shapes` where each block begins — the reveal boundary. */
  starts: number[]
  height: number
}

/**
 * Every block in a panel shares a column width, so the panel reads as a unit.
 *
 * This is the width the CONTENT wants, deliberately unrelated to the panel's
 * minimum width. Flooring it at the panel minimum padded narrow blocks out to
 * 276px each, which then left room for only two columns — so a panel of small
 * stacks stayed a tall strip no matter how much room it had to spread into.
 */
function columnWidth(blocks: Block[]): number {
  return Math.min(MAX_COL_W, Math.max(MIN_BOX_W, ...blocks.map(naturalWidth)))
}

/** How many columns of this width the panel is allowed to grow to. */
function maxColumns(colW: number): number {
  const avail = MAX_PANEL_W - 2 * PANEL_PAD
  return Math.max(1, Math.min(4, Math.floor((avail + COL_GAP) / (colW + COL_GAP))))
}

/**
 * Assigns blocks to columns, filling one before starting the next.
 *
 * A panel that only ever grows downward becomes the tall narrow strip this
 * rewrite set out to kill — six small stacks in one column is 900px of height
 * in 280px of width, and fitting that on screen shrinks the text to nothing.
 * Narrow blocks therefore get more columns to spread into than wide ones.
 *
 * The split is deliberately APPEND-ONLY: a block goes wherever the blocks
 * before it left off and never moves again. A balanced split would re-flow
 * earlier blocks into different columns every time a new one arrived, and the
 * board would rearrange itself under the learner mid-sentence.
 */
function splitColumns(heights: number[], limit: number): number[][] {
  const columns: number[][] = [[]]
  const used: number[] = [0]
  const add = (column: number, h: number) => {
    used[column] += (columns[column].length ? BLOCK_GAP : 0) + h
  }

  heights.forEach((h, i) => {
    let target = columns.length - 1
    const wouldBe = used[target] + BLOCK_GAP + h

    if (columns[target].length && wouldBe > MAX_COL_H) {
      if (columns.length < limit) {
        columns.push([])
        used.push(0)
        target = columns.length - 1
      } else {
        // Every column the panel is allowed already exists. Adding to the
        // shortest keeps the panel balanced instead of piling the remainder
        // into the last column — which is how a full panel went back to being
        // twice as tall as it was wide.
        target = used.indexOf(Math.min(...used))
      }
    }

    add(target, h)
    columns[target].push(i)
  })

  return columns
}

/**
 * Blocks rendered at the shared column width, flowed into columns, and shifted
 * into place. Both the shapes and the panel's own size come out of this, so it
 * runs once for both rather than the panel being laid out twice to be measured
 * and a third time to be drawn.
 */
function placeBlocks(blocks: Block[]): {
  perBlock: PanelShape[][]
  columns: number
  colW: number
  height: number
} {
  const colW = columnWidth(blocks)
  const rendered = blocks.map((b) => renderBlock(b, colW))
  const columns = splitColumns(
    rendered.map((r) => r.h),
    maxColumns(colW),
  )

  // Content is LEFT-ALIGNED, not centred. Centring re-derives every block's x
  // from the total content width, so the moment a second column opened, the
  // first column slid left and every shape already on the board jumped.
  const perBlock: PanelShape[][] = []
  let height = 0

  columns.forEach((column, c) => {
    const columnX = PANEL_PAD + c * (colW + COL_GAP)
    let y = PANEL_PAD
    for (const i of column) {
      const block = rendered[i]
      perBlock[i] = shift(
        block.shapes,
        columnX + Math.max(0, (colW - block.w) / 2),
        y,
      )
      y += block.h + BLOCK_GAP
    }
    height = Math.max(height, y - BLOCK_GAP + PANEL_PAD)
  })

  return {
    perBlock,
    columns: columns.length,
    colW,
    height: Math.max(MIN_PANEL_H, Math.round(height)),
  }
}

/**
 * A panel is its blocks, flowed into columns.
 *
 * There is deliberately no `width` argument. The panel's width is DERIVED from
 * its contents (`naturalPanelSize`), never imposed on them — a parameter here
 * would read as a constraint the layout does not actually honour, and the first
 * person to rely on it would get content drawn outside its own frame.
 */
export function renderPanel(blocks: Block[]): PanelRender {
  if (!blocks.length) return { shapes: [], starts: [], height: MIN_PANEL_H }

  const { perBlock, height } = placeBlocks(blocks)

  // Shapes are collected per block and flattened in BLOCK order, so `starts`
  // still marks the reveal boundary even though the blocks are not in one
  // top-to-bottom run any more.
  const shapes: PanelShape[] = []
  const starts: number[] = []
  for (let i = 0; i < blocks.length; i++) {
    starts.push(shapes.length)
    shapes.push(...(perBlock[i] ?? []))
  }

  return { shapes: shapes.map(snap), starts, height }
}

/**
 * How big this panel wants to be. Both numbers come from actually placing the
 * blocks, because a panel whose declared size disagrees with its contents is
 * precisely how things used to end up cut off at the frame's bottom edge.
 */
export function naturalPanelSize(blocks: Block[]): {
  width: number
  height: number
} {
  if (!blocks.length) return { width: MIN_PANEL_W, height: MIN_PANEL_H }

  const { columns, colW, height } = placeBlocks(blocks)
  const width = Math.min(
    MAX_PANEL_W,
    Math.max(
      MIN_PANEL_W,
      columns * colW + (columns - 1) * COL_GAP + 2 * PANEL_PAD,
    ),
  )
  return { width, height }
}
