import { describe, it, expect } from "vitest"
import { applySvgLineEdit, addLineNumbers } from "@/lib/svg-edit"

const svg = "<svg>\n<a/>\n<b/>\n</svg>"

describe("applySvgLineEdit", () => {
  it("replaces a single line", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 2,
      content: "<x/>",
    })
    expect(r).toEqual({ ok: true, svg: "<svg>\n<x/>\n<b/>\n</svg>" })
  })

  it("replaces a range with multi-line content", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 3,
      content: "<x/>\n<y/>",
    })
    expect(r).toEqual({ ok: true, svg: "<svg>\n<x/>\n<y/>\n</svg>" })
  })

  it("inserts before a line (start = end + 1)", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 1,
      content: "<ins/>",
    })
    expect(r).toEqual({
      ok: true,
      svg: "<svg>\n<ins/>\n<a/>\n<b/>\n</svg>",
    })
  })

  it("appends at end (start = length + 1)", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 5,
      end_line: 4,
      content: "<end/>",
    })
    expect(r).toEqual({
      ok: true,
      svg: "<svg>\n<a/>\n<b/>\n</svg>\n<end/>",
    })
  })

  it("errors on out-of-range", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 10,
      end_line: 10,
      content: "<z/>",
    })
    expect(r.ok).toBe(false)
  })
})

describe("addLineNumbers", () => {
  it("prefixes 1-indexed line numbers", () => {
    expect(addLineNumbers("a\nb")).toBe("1: a\n2: b")
  })
})
