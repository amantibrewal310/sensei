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
    p.push('{"type":"draw","instruction":"a box"}')
    expect(p.push("")).toEqual([])
    expect(p.flush()).toEqual([
      { type: "draw", instruction: "a box" },
    ])
  })

  it("skips malformed and unknown lines", () => {
    const p = new NdjsonActionParser()
    const out = p.push(
      'not json\n{"type":"nope"}\n{"type":"plan","intent":"teach"}\n',
    )
    expect(out).toEqual([{ type: "plan", intent: "teach" }])
  })
})
