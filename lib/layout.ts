import { GRID, type Board, type Connector, type Panel } from "./board"
import type { Block } from "./blocks"
import { MIN_PANEL_H, MIN_PANEL_W, naturalPanelSize } from "./render"

// The board's geometry, derived from what the panels actually hold.
//
// This used to be a fixed 1000x700 canvas cut into equal cells, which meant a
// panel's size had nothing to do with its contents: a one-column slot was 201px
// wide whether it held two words or a three-item diagram, and anything that
// didn't fit was pushed down until it fell out of the frame. Now the tracks size
// themselves to their panels, so a panel is never smaller than what is in it and
// overflow has nowhere to come from.

const MARGIN = 40
const GUTTER = 56

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedPanel extends Panel {
  rect: Rect
}

export interface Layout {
  panels: PlacedPanel[]
  connectors: Connector[]
  canvas: { width: number; height: number }
}

/** The blocks currently drawn in each panel, by panel id. */
export type PanelContent = ReadonlyMap<string, Block[]>

/**
 * The first thing every consumer of a `Layout` does. It lives here, with the
 * type, rather than being open-coded at each of the five call sites that need
 * it — each of which was also deciding independently what a miss means.
 */
export function panelById(layout: Layout, id: string): PlacedPanel | undefined {
  return layout.panels.find((p) => p.id === id)
}

/**
 * Lays a small board out left-to-right, whatever slots the model asked for.
 *
 * The canvas is far wider than it is tall, so two panels side by side are taken
 * in at a glance while a stacked pair has to be scrolled through. Asking for
 * this in the prompt did not hold — the model kept stacking.
 *
 * Spans are flattened too. They meant something when every cell was the same
 * fixed size and a panel had to claim two of them to be wide; now that a panel
 * is sized by what it holds, a span conveys nothing and only serves to push its
 * neighbour onto the next row.
 */
function preferSideBySide(panels: Panel[]): Panel[] {
  if (panels.length > GRID.cols) return panels
  return panels.map((p, i) => ({
    ...p,
    col: i,
    row: 0,
    colSpan: 1,
    rowSpan: 1,
  }))
}

function free(
  taken: boolean[][],
  col: number,
  row: number,
  w: number,
  h: number,
): boolean {
  if (col < 0 || row < 0 || col + w > GRID.cols || row + h > GRID.rows) {
    return false
  }
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) if (taken[r][c]) return false
  }
  return true
}

/**
 * Resolves the model's requested slots into a set of non-overlapping ones,
 * relocating a panel whose cell is already claimed and dropping one the grid has
 * no room for at all.
 *
 * This is the entire overlap guarantee. Two panels claiming the same cell is a
 * routine model error, and it used to reach the canvas as one diagram drawn on
 * top of another.
 */
export function placePanels(panels: Panel[]): {
  placed: Panel[]
  dropped: string[]
} {
  const taken: boolean[][] = Array.from({ length: GRID.rows }, () =>
    Array<boolean>(GRID.cols).fill(false),
  )
  const placed: Panel[] = []
  const dropped: string[] = []

  for (const panel of panels) {
    const w = Math.min(Math.max(1, panel.colSpan), GRID.cols)
    const h = Math.min(Math.max(1, panel.rowSpan), GRID.rows)

    let col = -1
    let row = -1
    if (free(taken, panel.col, panel.row, w, h)) {
      col = panel.col
      row = panel.row
    } else {
      outer: for (let r = 0; r <= GRID.rows - h; r++) {
        for (let c = 0; c <= GRID.cols - w; c++) {
          if (free(taken, c, r, w, h)) {
            col = c
            row = r
            break outer
          }
        }
      }
    }

    if (col === -1) {
      dropped.push(panel.id)
      continue
    }

    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) taken[r][c] = true
    }
    placed.push({ ...panel, col, row, colSpan: w, rowSpan: h })
  }

  return { placed, dropped }
}

/**
 * Sizes one axis of the grid to its content.
 *
 * A track that no panel occupies gets zero width and no gutter, so an unused
 * column costs nothing — which matters now that a page holds two or three
 * panels rather than filling the grid.
 */
function sizeTracks(
  panels: Panel[],
  count: number,
  start: (p: Panel) => number,
  span: (p: Panel) => number,
  need: (p: Panel) => number,
  min: number,
): number[] {
  const used = Array<boolean>(count).fill(false)
  for (const p of panels) {
    for (let i = start(p); i < start(p) + span(p); i++) used[i] = true
  }
  const tracks = used.map((u) => (u ? min : 0))

  for (const p of panels) {
    if (span(p) === 1) tracks[start(p)] = Math.max(tracks[start(p)], need(p))
  }

  // A panel spanning several tracks only forces them to grow if they cannot
  // already hold it between them.
  for (const p of panels) {
    const n = span(p)
    if (n === 1) continue
    let have = (n - 1) * GUTTER
    for (let i = start(p); i < start(p) + n; i++) have += tracks[i]
    if (need(p) <= have) continue
    const extra = (need(p) - have) / n
    for (let i = start(p); i < start(p) + n; i++) tracks[i] += extra
  }

  return tracks.map((t) => Math.ceil(t))
}

function offsetsOf(tracks: number[]): { offsets: number[]; extent: number } {
  const offsets: number[] = []
  let at = MARGIN
  for (const track of tracks) {
    offsets.push(at)
    if (track > 0) at += track + GUTTER
  }
  return { offsets, extent: at > MARGIN ? at - GUTTER + MARGIN : 2 * MARGIN }
}

function extentOf(tracks: number[], start: number, span: number): number {
  let total = 0
  let gutters = 0
  for (let i = start; i < start + span; i++) {
    total += tracks[i]
    if (tracks[i] > 0 && i > start) gutters++
  }
  return total + gutters * GUTTER
}

/** Do two panels' cell blocks share an edge (or a corner)? */
function adjacent(a: Panel, b: Panel): boolean {
  const gap = (aStart: number, aSpan: number, bStart: number, bSpan: number) =>
    Math.max(aStart - (bStart + bSpan), bStart - (aStart + aSpan))

  return (
    gap(a.col, a.colSpan, b.col, b.colSpan) <= 0 &&
    gap(a.row, a.rowSpan, b.row, b.rowSpan) <= 0
  )
}

const MAX_CONNECTORS = 3

export function layoutBoard(board: Board, content?: PanelContent): Layout {
  // A panel the grid had no room for is simply not placed. It used to be
  // reported back as `dropped`, which nothing ever read.
  const { placed } = placePanels(preferSideBySide(board.panels))

  const natural = new Map(
    placed.map((p) => [p.id, naturalPanelSize(content?.get(p.id) ?? [])]),
  )

  const colWidths = sizeTracks(
    placed,
    GRID.cols,
    (p) => p.col,
    (p) => p.colSpan,
    (p) => natural.get(p.id)!.width,
    MIN_PANEL_W,
  )
  const rowHeights = sizeTracks(
    placed,
    GRID.rows,
    (p) => p.row,
    (p) => p.rowSpan,
    (p) => natural.get(p.id)!.height,
    MIN_PANEL_H,
  )

  const cols = offsetsOf(colWidths)
  const rows = offsetsOf(rowHeights)

  const panels: PlacedPanel[] = placed.map((p) => ({
    ...p,
    rect: {
      x: cols.offsets[p.col],
      y: rows.offsets[p.row],
      width: extentOf(colWidths, p.col, p.colSpan),
      height: extentOf(rowHeights, p.row, p.rowSpan),
    },
  }))

  const byId = new Map(panels.map((p) => [p.id, p]))
  const connectors = board.connectors
    .filter((c) => {
      const from = byId.get(c.from)
      const to = byId.get(c.to)
      // An arrow to a panel that was dropped (or hallucinated) has nothing to
      // attach to, and an arrow between distant panels cuts straight through
      // whatever sits between them.
      if (!from || !to || from.id === to.id) return false
      return adjacent(from, to)
    })
    .slice(0, MAX_CONNECTORS)

  return { panels, connectors, canvas: { width: cols.extent, height: rows.extent } }
}
