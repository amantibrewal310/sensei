// The board is the lesson's whole diagram, decided once, up front.
//
// The model chooses only *semantics* here: which panels the lesson needs, which
// grid slots they sit in, and what connects to what. It never picks a pixel.
// `lib/layout.ts` turns this into geometry, which is why panels cannot collide.

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

export const GRID = { cols: 4, rows: 3 }

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
