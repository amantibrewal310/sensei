import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { BOARD_SYSTEM } from "@/lib/prompts"
import { BoardJsonSchema, GRID, type Board } from "@/lib/board"
import { layoutBoard } from "@/lib/layout"
import type { Step } from "@/lib/types"

export const runtime = "nodejs"

// Designs the whole board once, before any teaching happens, so that space the
// last question needs is reserved while the first question is still drawing.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    topic?: string
    steps?: Step[]
  } | null
  const topic = body?.topic
  const steps = body?.steps

  if (typeof topic !== "string" || !topic.trim() || !Array.isArray(steps)) {
    return NextResponse.json({ error: "topic and steps required" }, { status: 400 })
  }

  const questions = steps
    .map((s, i) => `Q${i + 1} (${s.label}): ${s.question}`)
    .join("\n")

  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    max_tokens: 2000,
    system: BOARD_SYSTEM,
    output_config: {
      format: { type: "json_schema", schema: BoardJsonSchema },
    },
    messages: [
      {
        role: "user",
        content:
          `Topic: ${topic}\n\nThe lesson will work through:\n${questions}\n\n` +
          `Grid is ${GRID.cols} columns x ${GRID.rows} rows. Design the board.`,
      },
    ],
  })

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no board" }, { status: 502 })
  }

  try {
    const board = JSON.parse(text.text) as Board
    // The model's slots are a request, not a promise — layoutBoard resolves any
    // collisions and drops what genuinely has no room.
    return NextResponse.json(layoutBoard(board))
  } catch {
    return NextResponse.json({ error: "invalid board" }, { status: 502 })
  }
}
