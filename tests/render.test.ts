import { describe, it, expect } from "vitest"
import type { Block } from "@/lib/blocks"
import { charsPerLine, labelSize, longestWord, wrap } from "@/lib/measure"
import { MAX_PANEL_W, naturalPanelSize, renderBlock, renderPanel } from "@/lib/render"
import type { BoxShape, PanelShape } from "@/lib/shapes"
import { item, items } from "./fixtures"

const boxes = (shapes: PanelShape[]) =>
  shapes.filter((s): s is BoxShape => s.kind === "box")

describe("measure", () => {
  it("wraps on word boundaries", () => {
    expect(wrap("fixed window counter", 14)).toEqual(["fixed window", "counter"])
  })

  it("makes a box wide enough for its longest word", () => {
    // The regression this whole rewrite exists for: a box too narrow for "svc"
    // did not wrap the word, it printed it as "sv / c".
    for (const text of ["svc A", "Microtask Queue", "sliding window log"]) {
      const { w } = labelSize(text)
      expect(charsPerLine(w)).toBeGreaterThanOrEqual(longestWord(text))
    }
  })

  it("keeps a label to the line count it was sized for", () => {
    const text = "requests per second"
    const { w } = labelSize(text)
    expect(wrap(text, charsPerLine(w)).length).toBeLessThanOrEqual(2)
  })
})

describe("renderBlock", () => {
  it("lays a short flow out across the panel", () => {
    const block: Block = { kind: "flow", items: items("client", "limiter", "svc") }
    const { shapes, h } = renderBlock(block, 900)
    const drawn = boxes(shapes)
    expect(drawn).toHaveLength(3)
    // Same row: every box shares a y, and x increases.
    expect(new Set(drawn.map((b) => b.y)).size).toBe(1)
    expect(drawn[0].x).toBeLessThan(drawn[1].x)
    expect(h).toBeLessThan(120)
  })

  it("turns a flow downward rather than squeezing it", () => {
    // This is the decision the model used to make badly. Given a narrow panel it
    // put three boxes side by side anyway, and each got three characters a line.
    const block: Block = {
      kind: "flow",
      items: items("10000 req/s", "service overloaded", "memory maxed"),
    }
    const { shapes } = renderBlock(block, 320)
    const drawn = boxes(shapes)
    expect(new Set(drawn.map((b) => b.x)).size).toBe(1)
    expect(drawn[0].y).toBeLessThan(drawn[1].y)
    for (const box of drawn) {
      expect(charsPerLine(box.w)).toBeGreaterThanOrEqual(longestWord(box.text))
    }
  })

  it("wraps a row onto a second line instead of shrinking its boxes", () => {
    const block: Block = { kind: "row", items: items("svc A", "svc B", "svc C", "svc D") }
    const narrow = boxes(renderBlock(block, 300).shapes)
    expect(new Set(narrow.map((b) => b.y)).size).toBeGreaterThan(1)
    for (const box of narrow) {
      expect(charsPerLine(box.w)).toBeGreaterThanOrEqual(longestWord(box.text))
    }
  })

  it("nests a stack's items strictly inside its container", () => {
    const block: Block = {
      kind: "stack",
      label: "bucket",
      items: items("token", "token", "token"),
    }
    const { shapes } = renderBlock(block, 500)
    const [container, ...tokens] = boxes(shapes)
    expect(tokens).toHaveLength(3)
    for (const token of tokens) {
      expect(token.x).toBeGreaterThan(container.x)
      expect(token.y).toBeGreaterThan(container.y)
      expect(token.x + token.w).toBeLessThanOrEqual(container.x + container.w)
      expect(token.y + token.h).toBeLessThanOrEqual(container.y + container.h)
    }
  })

  it("gives both sides of a comparison the same width", () => {
    const block: Block = {
      kind: "compare",
      left: { label: "without", items: items("one client hogs it") },
      right: { label: "with", items: items("fair share") },
    }
    const drawn = boxes(renderBlock(block, 600).shapes)
    expect(new Set(drawn.map((b) => b.w)).size).toBe(1)
  })

  it("fans a tree's arrows out from the root to each child", () => {
    const block: Block = {
      kind: "tree",
      root: item("rate limiting"),
      children: items("per user", "per IP", "per token"),
    }
    const { shapes } = renderBlock(block, 700)
    const arrows = shapes.filter((s) => s.kind === "arrow")
    expect(arrows).toHaveLength(3)
    // Every arrow leaves the same point — the root's foot — and they spread.
    expect(new Set(arrows.map((a) => a.x)).size).toBe(1)
    expect(new Set(arrows.map((a) => a.kind === "arrow" && a.dx)).size).toBe(3)
  })
})

describe("renderPanel", () => {
  const blocks: Block[] = [
    { kind: "flow", items: items("client", "limiter", "service") },
    { kind: "row", items: items("svc A", "svc B", "svc C") },
    { kind: "stack", label: "bucket", items: items("token", "token") },
    { kind: "note", text: "one bucket per user", color: "grey" },
  ]

  it("keeps every shape inside the panel it renders", () => {
    // The packer used to guarantee this by dropping whatever didn't fit. Now the
    // panel is measured from its contents, so everything fits by construction.
    const { width, height } = naturalPanelSize(blocks)
    const { shapes } = renderPanel(blocks)
    expect(shapes.length).toBeGreaterThan(0)
    for (const shape of shapes) {
      const w = shape.kind === "box" ? shape.w : 0
      const h = shape.kind === "box" ? shape.h : 0
      expect(shape.x).toBeGreaterThanOrEqual(0)
      expect(shape.y).toBeGreaterThanOrEqual(0)
      expect(shape.x + w).toBeLessThanOrEqual(width + 1)
      expect(shape.y + h).toBeLessThanOrEqual(height + 1)
    }
  })

  it("stacks blocks down the panel without overlapping them", () => {
    const { shapes, starts } = renderPanel(blocks)
    const bottomOf = (from: number, to: number) =>
      Math.max(...shapes.slice(from, to).map((s) => s.y + (s.kind === "box" ? s.h : 0)))
    const topOf = (from: number, to: number) =>
      Math.min(...shapes.slice(from, to).map((s) => s.y))

    for (let i = 1; i < starts.length; i++) {
      const prevEnd = starts[i]
      const end = starts[i + 1] ?? shapes.length
      expect(topOf(prevEnd, end)).toBeGreaterThanOrEqual(bottomOf(starts[i - 1], prevEnd))
    }
  })

  it("marks where each block begins, so only the new one is revealed", () => {
    const { starts } = renderPanel(blocks)
    expect(starts).toHaveLength(blocks.length)
    expect(starts[0]).toBe(0)
  })

  it("never grows past its max width", () => {
    for (let n = 1; n <= blocks.length; n++) {
      expect(naturalPanelSize(blocks.slice(0, n)).width).toBeLessThanOrEqual(MAX_PANEL_W)
    }
  })
})

describe("renderPanel — column flow", () => {
  const many: Block[] = Array.from({ length: 6 }, (_, i) => ({
    kind: "stack",
    label: `window ${i}`,
    items: items("req 1", "req 2", "req 3"),
  }))

  it("flows into a second column rather than becoming a tall strip", () => {
    // Six stacks in one column is 900px of height in 280px of width, and
    // fitting that on screen shrinks the text to nothing.
    const { width, height } = naturalPanelSize(many)
    const single = naturalPanelSize(many.slice(0, 1))
    expect(width).toBeGreaterThan(single.width * 1.5)
    expect(height / width).toBeLessThan(1.5)
  })

  it("still finds a second column when one block is wide", () => {
    // A single wide block used to set the column width for the whole panel,
    // leaving no room beside it however tall the panel grew.
    const wide: Block[] = [
      { kind: "row", items: items("client", "client", "client", "client", "client") },
      ...many,
    ]
    const { width, height } = naturalPanelSize(wide)
    expect(width).toBeLessThanOrEqual(MAX_PANEL_W)
    expect(height / width).toBeLessThan(1)
  })

  it("keeps a three-item flow horizontal at full column width", () => {
    const flow: Block = { kind: "flow", items: items("client", "limiter", "service") }
    const drawn = boxes(renderPanel([flow]).shapes)
    expect(new Set(drawn.map((b) => b.y)).size).toBe(1)
  })

  it("puts later blocks to the right of earlier ones once a column is full", () => {
    const { shapes, starts } = renderPanel(many)
    const columnOf = (block: number) => shapes[starts[block]].x
    expect(columnOf(many.length - 1)).toBeGreaterThan(columnOf(0))
  })

  it("never moves a block that is already on the board", () => {
    // The split is append-only for exactly this reason: a balanced split would
    // rearrange the panel under the learner every time a beat landed.
    for (let n = 2; n <= many.length; n++) {
      const before = renderPanel(many.slice(0, n - 1))
      const after = renderPanel(many.slice(0, n))
      for (let block = 0; block < n - 1; block++) {
        expect(after.shapes[after.starts[block]].x).toBe(
          before.shapes[before.starts[block]].x,
        )
        expect(after.shapes[after.starts[block]].y).toBe(
          before.shapes[before.starts[block]].y,
        )
      }
    }
  })
})
