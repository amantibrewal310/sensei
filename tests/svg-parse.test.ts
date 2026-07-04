import { describe, it, expect } from "vitest"
import { parseEditsFromBuffer } from "@/lib/svg-parse"

describe("parseEditsFromBuffer", () => {
  it("returns complete edits from a full buffer", () => {
    const buf =
      '{"edits":[{"start_line":1,"end_line":1,"content":"<a/>"},' +
      '{"start_line":2,"end_line":2,"content":"<b/>"}]}'
    expect(parseEditsFromBuffer(buf)).toEqual([
      { start_line: 1, end_line: 1, content: "<a/>" },
      { start_line: 2, end_line: 2, content: "<b/>" },
    ])
  })

  it("ignores a trailing incomplete edit", () => {
    const buf =
      '{"edits":[{"start_line":1,"end_line":1,"content":"<a/>"},' +
      '{"start_line":2,"end_line":2,"content":"<b'
    expect(parseEditsFromBuffer(buf)).toEqual([
      { start_line: 1, end_line: 1, content: "<a/>" },
    ])
  })

  it("returns [] when no complete edit yet", () => {
    expect(parseEditsFromBuffer('{"edits":[{"start_l')).toEqual([])
  })
})
