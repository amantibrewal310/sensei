import { GRID, type Board, type Connector, type Panel } from "./board"
import { truncate } from "./pack"

export const CANVAS = { width: 1000, height: 700 }
const MARGIN = 32
// Wide enough to be a LANE, not just a seam. Connector labels ride the midpoint
// of an arrow between two panels — with a thin gutter they had nowhere to sit
// and smeared across both panels they were joining. The camera zooms to fit, so
// a roomier board costs nothing on screen.
const GUTTER = 44

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
  /** Panels the model asked for that the grid had no room for. */
  dropped: string[]
}

const cellWidth =
  (CANVAS.width - 2 * MARGIN - (GRID.cols - 1) * GUTTER) / GRID.cols
const cellHeight =
  (CANVAS.height - 2 * MARGIN - (GRID.rows - 1) * GUTTER) / GRID.rows

/** The pixel box spanned by a block of grid cells. */
export function cellsToRect(
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
): Rect {
  return {
    x: Math.round(MARGIN + col * (cellWidth + GUTTER)),
    y: Math.round(MARGIN + row * (cellHeight + GUTTER)),
    width: Math.round(colSpan * cellWidth + (colSpan - 1) * GUTTER),
    height: Math.round(rowSpan * cellHeight + (rowSpan - 1) * GUTTER),
  }
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
 * Places panels on the grid, honouring the model's requested slot when it is
 * genuinely free and relocating the panel to the first free block of the same
 * size when it is not.
 *
 * This is the entire overlap guarantee. The model is asked for sensible slots
 * but never *trusted* for them: two panels claiming the same cell is a routine
 * model error, and it used to reach the canvas as one diagram drawn on top of
 * another. Here it costs a relocation instead.
 */
export function placePanels(panels: Panel[]): {
  placed: PlacedPanel[]
  dropped: string[]
} {
  const taken: boolean[][] = Array.from({ length: GRID.rows }, () =>
    Array<boolean>(GRID.cols).fill(false),
  )
  const placed: PlacedPanel[] = []
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

    // The board is full and this panel has nowhere to go. Dropping it is the
    // only honest option — drawing it anyway is what produced the overlaps.
    if (col === -1) {
      dropped.push(panel.id)
      continue
    }

    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) taken[r][c] = true
    }
    placed.push({
      ...panel,
      col,
      row,
      colSpan: w,
      rowSpan: h,
      rect: cellsToRect(col, row, w, h),
    })
  }

  return { placed, dropped }
}

/** Do two panels' cell blocks share an edge (or a corner)? */
export function adjacent(a: PlacedPanel, b: PlacedPanel): boolean {
  const gap = (
    aStart: number,
    aSpan: number,
    bStart: number,
    bSpan: number,
  ) => Math.max(aStart - (bStart + bSpan), bStart - (aStart + aSpan))

  const colGap = gap(a.col, a.colSpan, b.col, b.colSpan)
  const rowGap = gap(a.row, a.rowSpan, b.row, b.rowSpan)
  return colGap <= 0 && rowGap <= 0
}

const MAX_CONNECTORS = 4
const MAX_CONNECTOR_LABEL = 16

export function layoutBoard(board: Board): Layout {
  const { placed, dropped } = placePanels(board.panels)
  const byId = new Map(placed.map((p) => [p.id, p]))

  const connectors = board.connectors
    .filter((c) => {
      const from = byId.get(c.from)
      const to = byId.get(c.to)
      // A connector to a panel that was dropped (or hallucinated) has nothing
      // to attach to; an arrow pointing at empty canvas is worse than none.
      if (!from || !to || from.id === to.id) return false
      // An arrow between two distant panels cuts straight through whatever sits
      // between them. Only neighbours may be joined — enforced here rather than
      // merely requested, because the planner cannot see what it is crossing.
      return adjacent(from, to)
    })
    // Every arrow carries a label, and labels collide. A board with four clear
    // arrows reads; one with eight is the spaghetti this project started with.
    .slice(0, MAX_CONNECTORS)
    // The label rides the arrow's midpoint, out in the gutter between panels.
    // The gutter is wide, but it is not a paragraph.
    .map((c) => ({ ...c, label: truncate(c.label, MAX_CONNECTOR_LABEL) }))

  return { panels: placed, connectors, dropped }
}
