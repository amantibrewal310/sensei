import { describe, expect, it } from "vitest"
import { safeNext } from "@/lib/redirect"

describe("safeNext", () => {
  it("keeps a path on this site, query string and all", () => {
    // The reason `next` exists: type a topic while signed out and come back to
    // that topic rather than an empty box.
    expect(safeNext("/learn?topic=closures")).toBe("/learn?topic=closures")
  })

  it("refuses a protocol-relative URL", () => {
    // Passes `startsWith("/")`, and a browser sends it to another host. This is
    // the case the naive check misses and the whole function is for.
    expect(safeNext("//evil.example")).toBe("/")
  })

  it("refuses a backslash spelling of the same thing", () => {
    expect(safeNext("/\\evil.example")).toBe("/")
  })

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.example")).toBe("/")
  })

  it("falls back when there is no next at all", () => {
    expect(safeNext(undefined)).toBe("/")
    expect(safeNext(null)).toBe("/")
    expect(safeNext("")).toBe("/")
  })
})
