import { NextResponse } from "next/server"
import { anthropic, sseResponse } from "@/lib/anthropic"
import { PANEL_MODEL } from "@/lib/models"
import { PANEL_SYSTEM } from "@/lib/prompts"
import { ShapeLineParser, clampToPanel, type PanelShape } from "@/lib/shapes"
import { pack, type Rect } from "@/lib/pack"

export const runtime = "nodejs"

interface Body {
  title: string
  width: number
  height: number
  what: string
  /** The geometry already occupying this panel. Not a description of it — the actual boxes. */
  occupied: { x: number; y: number; w: number; h: number; text: string }[]
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const title = body?.title
  const width = body?.width
  const height = body?.height
  const what = body?.what
  const occupied = body?.occupied ?? []

  if (
    typeof title !== "string" ||
    typeof what !== "string" ||
    !what.trim() ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return NextResponse.json({ error: "invalid panel request" }, { status: 400 })
  }

  // Telling the model *what* it drew before is useless — it needs to know
  // WHERE. Handing it the occupied boxes, plus the first clear y below them, is
  // what stops a panel being drawn on top of itself.
  const lowest = occupied.reduce((max, o) => Math.max(max, o.y + o.h), 0)
  const freeY = lowest ? lowest + 14 : 16

  const alreadyThere = occupied.length
    ? `ALREADY DRAWN IN THIS PANEL — these boxes are taken, do not overlap them:\n` +
      occupied
        .map(
          (o) =>
            `- (${o.x}, ${o.y}) to (${o.x + o.w}, ${o.y + o.h})${o.text ? ` "${o.text}"` : ""}`,
        )
        .join("\n") +
      `\n\nThe first clear space below them starts at y = ${freeY}. There are ${Math.max(0, height - freeY)}px left.`
    : "This panel is empty. Start at y = 16."

  const userText =
    `Panel: "${title}"\nSize: ${width} x ${height} px (local coordinates, 0,0 is its top-left).\n\n` +
    `${alreadyThere}\n\nAdd now:\n${what}`

  async function* gen() {
    const stream = anthropic.messages.stream({
      model: PANEL_MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: PANEL_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userText }],
    })

    const parser = new ShapeLineParser()
    const w = width as number
    const h = height as number

    // Seeded with what earlier beats left behind, then grown as this beat emits
    // — so the model cannot collide with the past OR with itself mid-breath.
    const taken: Rect[] = occupied.map((o) => ({
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      labelled: !!o.text,
    }))

    const place = function* (shape: PanelShape) {
      const packed = pack(clampToPanel(shape, w, h), taken, w, h)
      if (!packed) return // panel is full; a dropped shape beats an unreadable one
      taken.push(...packed.rects)
      yield { event: "shape", data: packed.shape }
    }

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        for (const shape of parser.push(ev.delta.text)) yield* place(shape)
      }
    }
    for (const shape of parser.flush()) yield* place(shape)

    yield { event: "done", data: {} }
  }

  return sseResponse(gen())
}
