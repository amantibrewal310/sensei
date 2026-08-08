import { describe, it, expect } from "vitest"
import { dropRedundantLabel, parseBlock, type Block } from "@/lib/blocks"
import { MAX_LABEL } from "@/lib/measure"
import { LineParser } from "@/lib/ndjson"
import { item } from "./fixtures"

describe("parseBlock", () => {
  it("fills in the optional fields a terse model leaves out", () => {
    const block = parseBlock('{"kind":"row","items":[{"text":"svc A"}]}')
    expect(block).toEqual({
      kind: "row",
      items: [{ text: "svc A", color: "black", emphasis: false }],
    })
  })

  it("rejects a block with no kind, or a kind that isn't real", () => {
    expect(parseBlock('{"items":[{"text":"a"}]}')).toBeNull()
    expect(parseBlock('{"kind":"sketch","items":[{"text":"a"}]}')).toBeNull()
  })

  it("rejects the old coordinate vocabulary outright", () => {
    // There is no longer any way to express a position, which is the point.
    expect(
      parseBlock('{"kind":"box","x":10,"y":20,"w":100,"h":40,"text":"svc"}'),
    ).toBeNull()
  })

  it("cuts a label the model wrote as a sentence", () => {
    const block = parseBlock(
      '{"kind":"note","text":"the service runs out of memory and starts dropping requests"}',
    )
    expect(block?.kind).toBe("note")
    if (block?.kind === "note") {
      expect(block.text.length).toBeLessThanOrEqual(MAX_LABEL)
      // On a word boundary — a mid-word cut reads as a rendering bug.
      expect(block.text).not.toMatch(/\s$/)
      expect("the service runs out of memory and starts dropping requests").toContain(
        block.text,
      )
    }
  })

  it("refuses code — it belongs in the pane, not on the board", () => {
    expect(parseBlock('{"kind":"code","lines":["count += 1"]}')).toBeNull()
  })

  it("refuses an empty block", () => {
    expect(parseBlock('{"kind":"row","items":[]}')).toBeNull()
  })
})

describe("dropRedundantLabel", () => {
  const stack = (label: string): Block => ({
    kind: "stack",
    label,
    items: [item("token")],
  })

  it("drops a heading that repeats the panel's own title", () => {
    // The title is already drawn as the frame label, so this would print it
    // twice, one above the other.
    expect(
      dropRedundantLabel(stack("Core Requirements"), "Core requirements"),
    ).toMatchObject({
      label: undefined,
    })
  })

  it("keeps a heading that says something the title doesn't", () => {
    expect(dropRedundantLabel(stack("bucket"), "Token Bucket Mechanism")).toMatchObject({
      label: "bucket",
    })
  })

  it("leaves every other block kind alone", () => {
    const note: Block = { kind: "note", text: "the board", color: "grey" }
    expect(dropRedundantLabel(note, "the board")).toBe(note)
  })
})

describe("LineParser — blocks", () => {
  it("emits blocks as whole lines arrive, and holds the partial one", () => {
    const parser = new LineParser(parseBlock)
    expect(parser.push('{"kind":"note","text":"a"}\n{"kind":"note"')).toHaveLength(1)
    expect(parser.push(',"text":"b"}')).toHaveLength(0)
    expect(parser.flush()).toHaveLength(1)
  })

  it("skips a malformed line rather than failing the stream", () => {
    const parser = new LineParser(parseBlock)
    const blocks = parser.push('not json\n{"kind":"note","text":"ok"}\n')
    expect(blocks).toHaveLength(1)
  })
})
