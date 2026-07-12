import { describe, it, expect } from "vitest"
import { ShapeLineParser, clampToPanel, parseShape } from "@/lib/shapes"

describe("parseShape", () => {
  it("accepts a box and fills in defaults", () => {
    const s = parseShape('{"kind":"box","x":10,"y":20,"w":100,"h":40}')
    expect(s).toMatchObject({ kind: "box", color: "black", fill: "none", text: "" })
  })

  it("rejects a shape with an unknown kind", () => {
    expect(parseShape('{"kind":"spiral","x":0,"y":0}')).toBeNull()
  })

  it("rejects a colour outside the palette tldraw understands", () => {
    expect(
      parseShape('{"kind":"box","x":0,"y":0,"w":10,"h":10,"color":"#ff0000"}'),
    ).toBeNull()
  })

  it("rejects malformed JSON rather than throwing", () => {
    expect(parseShape("{not json")).toBeNull()
  })
})

describe("clampToPanel", () => {
  it("pulls a box that overflows the panel back inside", () => {
    const s = parseShape('{"kind":"box","x":180,"y":180,"w":80,"h":80}')!
    const c = clampToPanel(s, 200, 200)
    expect(c).toMatchObject({ x: 120, y: 120, w: 80, h: 80 })
  })

  it("shrinks a box that is larger than the panel itself", () => {
    const s = parseShape('{"kind":"box","x":0,"y":0,"w":500,"h":500}')!
    expect(clampToPanel(s, 200, 150)).toMatchObject({ w: 200, h: 150 })
  })

  it("keeps an arrow's head inside the panel", () => {
    const s = parseShape('{"kind":"arrow","x":10,"y":10,"dx":400,"dy":0}')!
    const c = clampToPanel(s, 200, 200)
    expect(c).toMatchObject({ x: 10, dx: 190 })
  })
})

describe("ShapeLineParser", () => {
  it("emits shapes as whole lines arrive and holds the partial", () => {
    const p = new ShapeLineParser()
    expect(p.push('{"kind":"box","x":0,"y":0,"w":10,"h":10}\n{"kind":"te')).toHaveLength(1)
    expect(p.push('xt","x":5,"y":5,"text":"hi"}\n')).toHaveLength(1)
    expect(p.flush()).toHaveLength(0)
  })

  it("skips a garbage line instead of failing the whole stream", () => {
    const p = new ShapeLineParser()
    const out = p.push('oops not json\n{"kind":"box","x":0,"y":0,"w":9,"h":9}\n')
    expect(out).toHaveLength(1)
  })
})
