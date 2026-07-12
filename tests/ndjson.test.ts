import { describe, it, expect } from "vitest"
import { NdjsonActionParser } from "@/lib/ndjson"

describe("NdjsonActionParser", () => {
  it("parses whole lines from one chunk", () => {
    const p = new NdjsonActionParser()
    const out = p.push(
      '{"type":"speak","text":"hi"}\n{"type":"done"}\n',
    )
    expect(out).toEqual([
      { type: "speak", text: "hi" },
      { type: "done" },
    ])
  })

  it("buffers a partial line across chunks", () => {
    const p = new NdjsonActionParser()
    expect(p.push('{"type":"spe')).toEqual([])
    expect(p.push('ak","text":"yo"}\n')).toEqual([
      { type: "speak", text: "yo" },
    ])
  })

  it("flush parses a final unterminated line", () => {
    const p = new NdjsonActionParser()
    p.push('{"type":"draw","panel":"stack","what":"a box"}')
    expect(p.push("")).toEqual([])
    expect(p.flush()).toEqual([
      { type: "draw", panel: "stack", what: "a box" },
    ])
  })

  it("parses a connector draw", () => {
    const p = new NdjsonActionParser()
    expect(p.push('{"type":"draw","connector":"loop"}\n')).toEqual([
      { type: "draw", connector: "loop" },
    ])
  })

  it("skips malformed and unknown lines", () => {
    const p = new NdjsonActionParser()
    const out = p.push(
      'not json\n{"type":"nope"}\n{"type":"speak","text":"ok"}\n',
    )
    expect(out).toEqual([{ type: "speak", text: "ok" }])
  })

  it("rejects a draw that names neither a panel nor a connector", () => {
    const p = new NdjsonActionParser()
    expect(p.push('{"type":"draw","instruction":"freehand"}\n')).toEqual([])
  })
})
