import type { Block, Item } from "@/lib/blocks"

// The post-parse shape of an `Item` — every optional field already filled in by
// the schema. Written out in each test file, a new required field on `Item`
// broke three files at once and had to be fixed three times.

export const item = (text: string): Item => ({
  text,
  color: "black",
  emphasis: false,
})

export const items = (...texts: string[]) => texts.map(item)

export const row = (...texts: string[]): Block => ({
  kind: "row",
  items: items(...texts),
})
