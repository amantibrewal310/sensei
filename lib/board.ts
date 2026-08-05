// A board is ONE page's diagram, decided up front for that page.
//
// The model chooses only *semantics* here: which panels the page needs, which
// grid slots they sit in, and what connects to what. It never picks a pixel.
// `lib/layout.ts` turns this into geometry, which is why panels cannot collide,
// and sizes each panel to whatever ends up inside it.

export interface Panel {
  id: string
  title: string
  col: number
  row: number
  colSpan: number
  rowSpan: number
  /** What the lesson will eventually want inside — a hint for the renderer. */
  note: string
}

export interface Connector {
  id: string
  from: string
  to: string
  label: string
}

export interface Board {
  panels: Panel[]
  connectors: Connector[]
}

// Small on purpose. A page covers one topic, so it needs two or three panels —
// the old 4x3 grid was sized for a whole lesson on a single canvas, which is
// exactly the clutter that pages exist to remove.
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
      .map(
        (c) =>
          `- connector "${c.id}" — ${c.from} to ${c.to}, labelled "${c.label}"`,
      )
      .join("\n"),
  }
}

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
