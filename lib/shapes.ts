// What actually reaches the canvas.
//
// This is now an *output* vocabulary only. Nothing outside this codebase emits a
// PanelShape: the model emits blocks (lib/blocks.ts) and lib/render.ts turns
// them into these. So there is no schema, no clamping and no parsing here any
// more — coordinates are computed, and computed coordinates are already inside
// their panel by construction.

export const COLORS = [
  "black",
  "grey",
  "blue",
  "light-blue",
  "green",
  "light-green",
  "orange",
  "red",
  "light-red",
  "violet",
  "light-violet",
  "yellow",
] as const

export type Color = (typeof COLORS)[number]
export type Fill = "none" | "semi" | "solid"

// The vocabulary is exactly as wide as lib/render.ts is: a box, a bare label,
// and an arrow. Ellipse, diamond and a mono font were carried over from when the
// model emitted shapes directly and code was drawn on the canvas; nothing can
// produce them now, so keeping them only left unreachable branches downstream in
// components/Board.tsx pretending the renderer had options it does not. Widen
// this when a block kind actually needs it.

export interface BoxShape {
  kind: "box"
  x: number
  y: number
  w: number
  h: number
  text: string
  color: Color
  fill: Fill
}

export interface TextShape {
  kind: "text"
  x: number
  y: number
  text: string
  color: Color
}

/** Always drawn bare — see the connector note in components/Board.tsx. */
export interface ArrowShape {
  kind: "arrow"
  x: number
  y: number
  /** Displacement from (x, y) to the arrow's head, in panel-local pixels. */
  dx: number
  dy: number
  color: Color
}

export type PanelShape = BoxShape | TextShape | ArrowShape
