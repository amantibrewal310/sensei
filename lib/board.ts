import { z } from "zod"

// A board is ONE page's diagram, decided up front for that page.
//
// The model chooses only *semantics* here: which panels the page needs, which
// grid slots they sit in, and what connects to what. It never picks a pixel.
// `lib/layout.ts` turns this into geometry, which is why panels cannot collide,
// and sizes each panel to whatever ends up inside it.

// Structural validation only. Slots are deliberately NOT checked against GRID:
// `placePanels` already clamps the spans and searches for a free slot when the
// requested one is taken or off the grid, and rejecting a whole board because
// one panel asked for column 5 would throw away five good panels to punish one.
// What this does catch is a `col` that is a string, a NaN, or negative — the
// last of which would index backwards into the occupancy grid.
const Slot = z.number().int().min(0).max(64)
const Span = z.number().int().min(1).max(64)

const PanelSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  col: Slot,
  row: Slot,
  colSpan: Span,
  rowSpan: Span,
  /** What the lesson will eventually want inside — a hint for the renderer. */
  note: z.string().default(""),
})

const ConnectorSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().default(""),
})

export const BoardSchema = z.object({
  panels: z.array(PanelSchema).min(1).max(12),
  connectors: z.array(ConnectorSchema).max(8).default([]),
})

// Inferred rather than declared alongside, so the shape the code believes in and
// the shape that is actually validated cannot drift apart — the same reason
// PAGE_KIND in lib/lesson.ts is an exhaustive Record instead of a lookup.
export type Panel = z.infer<typeof PanelSchema>
export type Connector = z.infer<typeof ConnectorSchema>
export type Board = z.infer<typeof BoardSchema>

/**
 * The board's inventory as the teacher prompt lists it — ids, titles, notes.
 *
 * It lives here, with the shape it reads, rather than in the route: the route's
 * job is to assemble a prompt, not to know how a `Panel` is spelled.
 */
export function describeBoard(board: Board): {
  panels: string
  connectors: string
} {
  return {
    panels: board.panels
      .map((p) => `- panel "${p.id}" — ${p.title}: ${p.note}`)
      .join("\n"),
    connectors: board.connectors
      .map((c) => `- connector "${c.id}" — ${c.from} to ${c.to}, labelled "${c.label}"`)
      .join("\n"),
  }
}

// Small on purpose. A page covers one topic, so it needs two or three panels —
// the old 4x3 grid was sized for a whole lesson on a single canvas, which is
// exactly the clutter that pages exist to remove.
export const GRID = { cols: 3, rows: 2 }

export const BoardJsonSchema = {
  type: "object",
  properties: {
    panels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          col: { type: "integer" },
          row: { type: "integer" },
          colSpan: { type: "integer" },
          rowSpan: { type: "integer" },
          note: { type: "string" },
        },
        required: ["id", "title", "col", "row", "colSpan", "rowSpan", "note"],
        additionalProperties: false,
      },
    },
    connectors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string" },
        },
        required: ["id", "from", "to", "label"],
        additionalProperties: false,
      },
    },
  },
  required: ["panels", "connectors"],
  additionalProperties: false,
} as const
