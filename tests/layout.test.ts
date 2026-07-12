import { describe, it, expect } from "vitest"
import { GRID, type Panel } from "@/lib/board"
import { CANVAS, layoutBoard, placePanels, type Rect } from "@/lib/layout"

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
    const { placed } = placePanels([panel("a", 1, 1), panel("b", 3, 2)])
    expect(placed.map((p) => [p.col, p.row])).toEqual([
      [1, 1],
      [3, 2],
    ])
  })

  it("relocates a panel that claims a cell someone else already has", () => {
    // The model overlapping two panels is a routine error, and this is the
    // whole reason the board used to end up drawn on top of itself.
    const { placed } = placePanels([panel("a", 0, 0), panel("b", 0, 0)])
    expect(placed).toHaveLength(2)
    expect(placed[0].rect).toBeDefined()
    expect(overlaps(placed[0].rect, placed[1].rect)).toBe(false)
  })

  it("never produces overlapping rects, however badly the model stacks them", () => {
    const all = Array.from({ length: 8 }, (_, i) => panel(`p${i}`, 0, 0, 2, 1))
    const { placed } = placePanels(all)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i].rect, placed[j].rect)).toBe(false)
      }
    }
  })

  it("drops panels once the grid is genuinely full rather than stacking them", () => {
    const tooMany = Array.from({ length: GRID.cols * GRID.rows + 3 }, (_, i) =>
      panel(`p${i}`, 0, 0),
    )
    const { placed, dropped } = placePanels(tooMany)
    expect(placed).toHaveLength(GRID.cols * GRID.rows)
    expect(dropped).toHaveLength(3)
  })

  it("keeps every panel inside the canvas", () => {
    const { placed } = placePanels([panel("wide", 0, 0, GRID.cols, GRID.rows)])
    const { rect } = placed[0]
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(CANVAS.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(CANVAS.height)
  })

  it("clamps a span that runs off the grid", () => {
    const { placed } = placePanels([panel("huge", 0, 0, 99, 99)])
    expect(placed[0].colSpan).toBe(GRID.cols)
    expect(placed[0].rowSpan).toBe(GRID.rows)
  })
})

describe("layoutBoard", () => {
  it("drops connectors whose endpoints didn't make it onto the board", () => {
    const board = {
      panels: [panel("a", 0, 0), panel("b", 1, 0)],
      connectors: [
        { id: "ok", from: "a", to: "b", label: "flows" },
        { id: "ghost", from: "a", to: "nonexistent", label: "nowhere" },
        { id: "self", from: "a", to: "a", label: "loop" },
      ],
    }
    const layout = layoutBoard(board)
    expect(layout.connectors.map((c) => c.id)).toEqual(["ok"])
  })

  it("drops a connector between panels that don't touch", () => {
    // An arrow from column 0 to column 3 cuts straight through columns 1 and 2.
    const board = {
      panels: [panel("left", 0, 0), panel("mid", 1, 0), panel("right", 3, 0)],
      connectors: [
        { id: "near", from: "left", to: "mid", label: "ok" },
        { id: "far", from: "left", to: "right", label: "crosses everything" },
      ],
    }
    expect(layoutBoard(board).connectors.map((c) => c.id)).toEqual(["near"])
  })

  it("caps the number of connectors so their labels can't pile up", () => {
    const panels = [
      panel("a", 0, 0),
      panel("b", 1, 0),
      panel("c", 2, 0),
      panel("d", 3, 0),
      panel("e", 0, 1),
      panel("f", 1, 1),
    ]
    const connectors = [
      { id: "1", from: "a", to: "b", label: "" },
      { id: "2", from: "b", to: "c", label: "" },
      { id: "3", from: "c", to: "d", label: "" },
      { id: "4", from: "a", to: "e", label: "" },
      { id: "5", from: "b", to: "f", label: "" },
      { id: "6", from: "e", to: "f", label: "" },
    ]
    expect(layoutBoard({ panels, connectors }).connectors).toHaveLength(4)
  })
})
