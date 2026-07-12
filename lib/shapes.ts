import { z } from "zod"

// The vocabulary the panel model draws with. Deliberately far smaller than
// tldraw's shape API: the model picks meaning (a labelled box, an arrow between
// two things) and never touches tldraw internals, ids, or parenting. Anything it
// emits outside this schema is dropped rather than rendered.

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

const Color = z.enum(COLORS).default("black")
const Fill = z.enum(["none", "semi", "solid"]).default("none")

const Box = z.object({
  kind: z.enum(["box", "ellipse", "diamond"]),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  text: z.string().default(""),
  color: Color,
  fill: Fill,
})

const Label = z.object({
  kind: z.literal("text"),
  x: z.number(),
  y: z.number(),
  text: z.string().min(1),
  color: Color,
})

const Arrow = z.object({
  kind: z.literal("arrow"),
  x: z.number(),
  y: z.number(),
  /** Displacement from (x, y) to the arrow's head, in panel-local pixels. */
  dx: z.number(),
  dy: z.number(),
  text: z.string().default(""),
  color: Color,
})

export const PanelShape = z.discriminatedUnion("kind", [Box, Label, Arrow])
export type PanelShape = z.infer<typeof PanelShape>

export function parseShape(line: string): PanelShape | null {
  try {
    const result = PanelShape.safeParse(JSON.parse(line))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Keeps a shape inside its panel. Frames clip their children, so an escaping
 * shape would be silently sliced in half rather than spilling onto a neighbour —
 * still wrong, just quietly wrong. Nudging it back in is kinder than clipping.
 */
export function clampToPanel(
  shape: PanelShape,
  width: number,
  height: number,
): PanelShape {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max))

  if (shape.kind === "text") {
    return { ...shape, x: clamp(shape.x, width - 8), y: clamp(shape.y, height - 8) }
  }
  if (shape.kind === "arrow") {
    const x = clamp(shape.x, width)
    const y = clamp(shape.y, height)
    return {
      ...shape,
      x,
      y,
      dx: clamp(x + shape.dx, width) - x,
      dy: clamp(y + shape.dy, height) - y,
    }
  }

  const w = Math.min(shape.w, width)
  const h = Math.min(shape.h, height)
  return {
    ...shape,
    w,
    h,
    x: clamp(shape.x, width - w),
    y: clamp(shape.y, height - h),
  }
}

/** One NDJSON shape per line, tolerating the trailing partial line. */
export class ShapeLineParser {
  private buffer = ""

  push(chunk: string): PanelShape[] {
    this.buffer += chunk
    const out: PanelShape[] = []
    let nl: number
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      const shape = line && parseShape(line)
      if (shape) out.push(shape)
    }
    return out
  }

  flush(): PanelShape[] {
    const line = this.buffer.trim()
    this.buffer = ""
    const shape = line && parseShape(line)
    return shape ? [shape] : []
  }
}
