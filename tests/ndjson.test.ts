import { describe, it, expect } from "vitest"
import { LineParser, parseAction } from "@/lib/ndjson"
import { MAX_CODE_COLS, MAX_CODE_LINES } from "@/lib/code"

describe("LineParser — teacher actions", () => {
  it("parses whole lines from one chunk", () => {
    const p = new LineParser(parseAction)
    const out = p.push('{"type":"speak","text":"hi"}\n{"type":"done"}\n')
    expect(out).toEqual([{ type: "speak", text: "hi" }, { type: "done" }])
  })

  it("buffers a partial line across chunks", () => {
    const p = new LineParser(parseAction)
    expect(p.push('{"type":"spe')).toEqual([])
    expect(p.push('ak","text":"yo"}\n')).toEqual([{ type: "speak", text: "yo" }])
  })

  it("flush parses a final unterminated line", () => {
    const p = new LineParser(parseAction)
    p.push('{"type":"draw","panel":"stack","what":"a box"}')
    expect(p.push("")).toEqual([])
    expect(p.flush()).toEqual([{ type: "draw", panel: "stack", what: "a box" }])
  })

  it("parses a connector draw", () => {
    const p = new LineParser(parseAction)
    expect(p.push('{"type":"draw","connector":"loop"}\n')).toEqual([
      { type: "draw", connector: "loop" },
    ])
  })

  it("skips malformed and unknown lines", () => {
    const p = new LineParser(parseAction)
    const out = p.push('not json\n{"type":"nope"}\n{"type":"speak","text":"ok"}\n')
    expect(out).toEqual([{ type: "speak", text: "ok" }])
  })

  it("rejects a draw that names neither a panel nor a connector", () => {
    const p = new LineParser(parseAction)
    expect(p.push('{"type":"draw","instruction":"freehand"}\n')).toEqual([])
  })
})

describe("LineParser — code", () => {
  it("parses a code snippet, keeping its indentation", () => {
    const p = new LineParser(parseAction)
    expect(
      p.push(
        '{"type":"code","label":"allow()","lines":["if count < limit:","  count += 1"]}\n',
      ),
    ).toEqual([
      {
        type: "code",
        label: "allow()",
        lines: ["if count < limit:", "  count += 1"],
      },
    ])
  })

  it("turns tabs into spaces so columns line up in a mono font", () => {
    const p = new LineParser(parseAction)
    const [action] = p.push('{"type":"code","lines":["def allow():","\\treturn True"]}\n')
    expect(action).toMatchObject({ type: "code", label: "" })
    if (action.type === "code") expect(action.lines[1]).toBe("  return True")
  })

  it("trims the blank lines a model pads a snippet with", () => {
    const p = new LineParser(parseAction)
    const [action] = p.push('{"type":"code","lines":["","a = 1",""]}\n')
    if (action.type === "code") expect(action.lines).toEqual(["a = 1"])
  })

  it("drops a code line with nothing in it", () => {
    const p = new LineParser(parseAction)
    expect(p.push('{"type":"code","lines":[]}\n')).toEqual([])
    expect(p.push('{"type":"code","label":"x"}\n')).toEqual([])
  })

  it("bounds a runaway snippet", () => {
    const p = new LineParser(parseAction)
    const lines = Array.from({ length: 40 }, () => "x".repeat(200))
    const [action] = p.push(`${JSON.stringify({ type: "code", lines })}\n`)
    if (action.type === "code") {
      expect(action.lines.length).toBe(MAX_CODE_LINES)
      expect(action.lines[0]).toHaveLength(MAX_CODE_COLS)
    }
  })
})
