import { describe, it, expect } from "vitest"
import {
  pack,
  textHeight,
  charsPerLine,
  truncate,
  MAX_TEXT,
  MAX_ARROW_TEXT,
  type Rect,
} from "@/lib/pack"
import type { PanelShape } from "@/lib/shapes"

const W = 200
const H = 300

function box(x: number, y: number, w: number, h: number, text = ""): PanelShape {
  return { kind: "box", x, y, w, h, text, color: "black", fill: "none" }
}
function label(x: number, y: number, text: string): PanelShape {
  return { kind: "text", x, y, text, color: "black" }
}
function rect(x: number, y: number, w: number, h: number, labelled = false): Rect {
  return { x, y, w, h, labelled }
}

describe("pack", () => {
  it("leaves a shape alone when its space is free", () => {
    const p = pack(box(10, 20, 100, 40), [], W, H)
    expect(p!.shape).toMatchObject({ x: 10, y: 20 })
  })

  it("pushes a box down past one it would half-cover", () => {
    const taken = [rect(10, 20, 100, 40)]
    const p = pack(box(10, 40, 100, 40), taken, W, H)
    // Straddling the existing box is the failure; sliding below it is the fix.
    expect(p!.shape.y).toBeGreaterThanOrEqual(60)
  })

  it("allows a box nested fully inside another — the call-stack pattern", () => {
    // The stack is an outer box with frames drawn INSIDE it. If packing treated
    // that as a collision it would eject every frame out of its own container.
    const outer = [rect(10, 10, 180, 280)]
    const p = pack(box(20, 30, 150, 40, "main()"), outer, W, H)
    expect(p!.shape).toMatchObject({ x: 20, y: 30 })
  })

  it("never lets a bare label touch an existing shape", () => {
    const taken = [rect(0, 0, 200, 60, true)]
    const p = pack(label(10, 20, "high prio"), taken, W, H)
    expect(p!.shape.y).toBeGreaterThanOrEqual(60)
  })

  it("grows a box that is too short for its own text", () => {
    // A box shorter than its label doesn't clip the text, it spills it out.
    const long = "browser handles all the slow work"
    const p = pack(box(0, 0, 120, 20, long), [], W, H)
    expect(p!.shape.kind).toBe("box")
    if (p!.shape.kind === "box") {
      // The label is capped at MAX_TEXT, so the box must fit what actually
      // renders — not the longer string the model asked for.
      expect(p!.shape.text.length).toBeLessThanOrEqual(MAX_TEXT)
      expect(p!.shape.h).toBeGreaterThanOrEqual(
        textHeight(p!.shape.text, p!.shape.w),
      )
    }
  })

  it("truncates on a word boundary rather than mid-word", () => {
    // A hard character cut leaves "micro: urgen" on the board, which reads as a
    // rendering bug rather than a diagram.
    expect(truncate("microtask queue is urgent", 16)).toBe("microtask queue")
    expect(truncate("short", 16)).toBe("short")
    // A single word longer than the limit has no boundary to fall back on.
    expect(truncate("supercalifragilistic", 8)).toBe("supercal")
  })

  it("cuts a floating label down to what the panel can actually hold", () => {
    const p = pack(label(0, 0, "a very long sentence that will run off the panel"), [], W, H)
    expect(p!.shape.kind).toBe("text")
    if (p!.shape.kind === "text") {
      expect(p!.shape.text.length).toBeLessThanOrEqual(charsPerLine(W))
    }
  })

  it("drops a shape when the panel has genuinely run out of room", () => {
    const full = [rect(0, 0, 200, 295)]
    expect(pack(box(0, 0, 100, 40), full, W, H)).toBeNull()
  })

  it("keeps a packed run of shapes free of partial overlaps", () => {
    const taken: Rect[] = []
    const shapes = Array.from({ length: 5 }, () => box(10, 10, 120, 40, "x"))
    for (const s of shapes) {
      const p = pack(s, taken, W, H)
      if (p) taken.push(...p.rects)
    }
    for (let i = 0; i < taken.length; i++) {
      for (let j = i + 1; j < taken.length; j++) {
        const a = taken[i]
        const b = taken[j]
        const hit =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(hit).toBe(false)
      }
    }
  })
})

describe("pack — arrows", () => {
  const arrow = (text: string): PanelShape => ({
    kind: "arrow",
    x: 100,
    y: 100,
    dx: 0,
    dy: 60,
    text,
    color: "red",
  })

  it("leaves an arrow where it was aimed, even across a busy area", () => {
    // Moving an arrow destroys what it points at, so it never gets relocated.
    const p = pack(arrow("pops"), [rect(0, 0, 200, 200)], W, H)
    expect(p!.shape).toMatchObject({ x: 100, y: 100, dx: 0, dy: 60 })
  })

  it("reserves the arrow's label so the next shape can't sit on it", () => {
    const p = pack(arrow("pops"), [], W, H)
    // Two rects: the line, and the label floating at its midpoint.
    expect(p!.rects).toHaveLength(2)
    const label = p!.rects[1]
    expect(label.y).toBeCloseTo(100 + 30 - 13, 0) // centred on the midpoint
  })

  it("drops the label — not the arrow — when the label has no room", () => {
    // The arrow's midpoint lands inside an existing box. Printing "pops" there
    // would smear it across the box's own text; a bare arrow still reads.
    const p = pack(arrow("pops"), [rect(0, 110, 200, 60, true)], W, H)
    expect(p!.shape).toMatchObject({ x: 100, y: 100, text: "" })
    expect(p!.rects).toHaveLength(1)
  })

  it("keeps an arrow label short enough not to wrap", () => {
    const p = pack(arrow("pops off the top of the stack"), [], W, H)
    expect(p!.shape.text.length).toBeLessThanOrEqual(MAX_ARROW_TEXT)
  })

  it("drops an arrow that slashes through the whole panel", () => {
    // Not an arrow pointing at something — a scratch across the diagram.
    const slasher: PanelShape = {
      kind: "arrow",
      x: 10,
      y: 0,
      dx: 100,
      dy: 290,
      text: "",
      color: "green",
    }
    const busy = [
      rect(0, 20, 200, 40),
      rect(0, 90, 200, 40),
      rect(0, 160, 200, 40),
      rect(0, 230, 200, 40),
    ]
    expect(pack(slasher, busy, W, H)).toBeNull()
  })

  it("still allows an arrow joining two neighbouring shapes", () => {
    const short: PanelShape = {
      kind: "arrow",
      x: 100,
      y: 55,
      dx: 0,
      dy: 40,
      text: "pops",
      color: "red",
    }
    const stacked = [rect(0, 20, 200, 40), rect(0, 90, 200, 40)]
    expect(pack(short, stacked, W, H)).not.toBeNull()
  })
})

describe("pack — sizing text to fit", () => {
  it("widens a box so its label doesn't wrap into a column", () => {
    const p = pack(box(0, 0, 40, 44, "browser handles it"), [], W, H)
    if (p!.shape.kind === "box") {
      // Two lines at most, not eight characters stacked vertically.
      expect(p!.shape.w).toBeGreaterThan(40)
      expect(textHeight(p!.shape.text, p!.shape.w)).toBeLessThanOrEqual(2 * 26 + 16)
    }
  })

  it("makes a box wide enough for its longest word", () => {
    // A line too short for "Microtask" doesn't wrap the word, it snaps it in
    // half as "Microtas / k".
    const p = pack(box(0, 0, 60, 44, "Microtask Queue"), [], W, H)!
    if (p.shape.kind === "box") {
      expect(charsPerLine(p.shape.w)).toBeGreaterThanOrEqual("Microtask".length)
    }
  })

  it("gives an ellipse extra width, since text only gets its inscribed area", () => {
    const ellipse: PanelShape = {
      kind: "ellipse",
      x: 0,
      y: 0,
      w: 60,
      h: 60,
      text: "stuck",
      color: "red",
      fill: "none",
    }
    const asBox = pack(box(0, 0, 60, 60, "stuck"), [], W, H)!
    const asEllipse = pack(ellipse, [], W, H)!
    if (asEllipse.shape.kind === "ellipse" && asBox.shape.kind === "box") {
      expect(asEllipse.shape.w).toBeGreaterThan(asBox.shape.w)
    }
  })
})
