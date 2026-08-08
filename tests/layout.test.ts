import { describe, it, expect } from "vitest"
import { GRID, type Panel } from "@/lib/board"
import { layoutBoard, placePanels, type Rect } from "@/lib/layout"
import { naturalPanelSize } from "@/lib/render"
import type { Block } from "@/lib/blocks"
import { row } from "./fixtures"

function panel(id: string, col: number, row: number, colSpan = 1, rowSpan = 1): Panel {
  return { id, title: id, col, row, colSpan, rowSpan, note: "" }
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

describe("placePanels", () => {
  it("keeps the slot the model asked for when it is free", () => {
    const { placed } = placePanels([panel("a", 1, 1), panel("b", 2, 0)])
    expect(placed.map((p) => [p.col, p.row])).toEqual([
      [1, 1],
      [2, 0],
    ])
  })

  it("relocates a panel that claims a cell someone else already has", () => {
    // The model overlapping two panels is a routine error, and this is the
    // whole reason the board used to end up drawn on top of itself.
    const { placed } = placePanels([panel("a", 0, 0), panel("b", 0, 0)])
    expect(placed).toHaveLength(2)
    expect([placed[1].col, placed[1].row]).not.toEqual([0, 0])
  })

  it("drops panels once the grid is genuinely full rather than stacking them", () => {
    const tooMany = Array.from({ length: GRID.cols * GRID.rows + 3 }, (_, i) =>
      panel(`p${i}`, 0, 0),
    )
    const { placed, dropped } = placePanels(tooMany)
    expect(placed).toHaveLength(GRID.cols * GRID.rows)
    expect(dropped).toHaveLength(3)
  })

  it("clamps a span that runs off the grid", () => {
    const { placed } = placePanels([panel("huge", 0, 0, 99, 99)])
    expect(placed[0].colSpan).toBe(GRID.cols)
    expect(placed[0].rowSpan).toBe(GRID.rows)
  })
})

describe("layoutBoard", () => {
  it("never produces overlapping rects, however badly the model stacks them", () => {
    const all = Array.from({ length: 6 }, (_, i) => panel(`p${i}`, 0, 0, 2, 1))
    const { panels } = layoutBoard({ panels: all, connectors: [] })
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        expect(overlaps(panels[i].rect, panels[j].rect)).toBe(false)
      }
    }
  })

  it("gives a panel at least the room its contents need", () => {
    // This is the guarantee that replaces the collision packer: a panel is
    // derived from its blocks, so content can never outgrow its frame.
    const content = new Map<string, Block[]>([
      ["wordy", [row("fixed window counter", "sliding window log")]],
    ])
    const board = {
      panels: [panel("wordy", 0, 0), panel("small", 1, 0)],
      connectors: [],
    }
    const { panels } = layoutBoard(board, content)

    const wordy = panels.find((p) => p.id === "wordy")!
    const need = naturalPanelSize(content.get("wordy")!)
    expect(wordy.rect.width).toBeGreaterThanOrEqual(need.width)
    expect(wordy.rect.height).toBeGreaterThanOrEqual(need.height)
  })

  it("grows the column when the panel in it grows", () => {
    const board = { panels: [panel("a", 0, 0)], connectors: [] }
    const empty = layoutBoard(board)
    const full = layoutBoard(
      board,
      new Map([
        ["a", [row("fixed window counter", "sliding window log", "token bucket")]],
      ]),
    )
    expect(full.panels[0].rect.width).toBeGreaterThan(empty.panels[0].rect.width)
    expect(full.canvas.width).toBeGreaterThan(empty.canvas.width)
  })

  it("charges nothing for grid columns no panel uses", () => {
    // A page has two or three panels on a six-cell grid. If unused tracks still
    // reserved a minimum width, every page would be padded with empty canvas.
    const oneCol = layoutBoard({ panels: [panel("a", 0, 0)], connectors: [] })
    const twoCols = layoutBoard({
      panels: [panel("a", 0, 0), panel("b", 1, 0)],
      connectors: [],
    })
    expect(twoCols.canvas.width).toBeGreaterThan(oneCol.canvas.width)
  })

  it("lays a small board out left to right, however the model stacked it", () => {
    // The canvas is far wider than it is tall. Asking the model for this in the
    // prompt did not hold, and it is a pure geometry decision anyway.
    const { panels } = layoutBoard({
      panels: [panel("mechanism", 0, 0), panel("implementation", 0, 1)],
      connectors: [],
    })
    expect(panels.map((p) => [p.col, p.row])).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(panels[0].rect.y).toBe(panels[1].rect.y)
  })

  it("flattens spans, which no longer mean anything once panels size themselves", () => {
    // A span used to be how a panel claimed extra area on a fixed grid. Left in
    // place it just pushes its neighbour onto the next row.
    const { panels } = layoutBoard({
      panels: [panel("wide", 0, 0, 2, 2), panel("under", 0, 1)],
      connectors: [],
    })
    expect(panels.map((p) => [p.col, p.row, p.colSpan, p.rowSpan])).toEqual([
      [0, 0, 1, 1],
      [1, 0, 1, 1],
    ])
  })

  it("leaves a board too big for one row to the grid", () => {
    const many = Array.from({ length: GRID.cols + 1 }, (_, i) =>
      panel(`p${i}`, i % GRID.cols, i < GRID.cols ? 0 : 1),
    )
    const { panels } = layoutBoard({ panels: many, connectors: [] })
    expect(panels.some((p) => p.row === 1)).toBe(true)
  })

  it("keeps every panel inside the canvas", () => {
    const { panels, canvas } = layoutBoard({
      panels: [panel("wide", 0, 0, GRID.cols, GRID.rows)],
      connectors: [],
    })
    const { rect } = panels[0]
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(canvas.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(canvas.height)
  })

  it("drops connectors whose endpoints didn't make it onto the board", () => {
    const layout = layoutBoard({
      panels: [panel("a", 0, 0), panel("b", 1, 0)],
      connectors: [
        { id: "ok", from: "a", to: "b", label: "flows" },
        { id: "ghost", from: "a", to: "nonexistent", label: "nowhere" },
        { id: "self", from: "a", to: "a", label: "loop" },
      ],
    })
    expect(layout.connectors.map((c) => c.id)).toEqual(["ok"])
  })

  it("drops a connector between panels that don't touch", () => {
    // An arrow from column 0 to column 2 cuts straight through column 1.
    const layout = layoutBoard({
      panels: [panel("left", 0, 0), panel("mid", 1, 0), panel("right", 2, 0)],
      connectors: [
        { id: "near", from: "left", to: "mid", label: "ok" },
        { id: "far", from: "left", to: "right", label: "crosses everything" },
      ],
    })
    expect(layout.connectors.map((c) => c.id)).toEqual(["near"])
  })
})
