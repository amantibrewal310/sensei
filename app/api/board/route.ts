import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { BOARD_SYSTEM } from "@/lib/prompts"
import { BoardJsonSchema, GRID, type Board } from "@/lib/board"
import type { Page } from "@/lib/lesson"

export const runtime = "nodejs"

// One board per page, designed when the page is about to be taught. Doing it per
// page rather than once for the lesson is what lets a page hold two roomy panels
// instead of a twelfth of the canvas each.
//
// The slots come back as the model asked for them; `layoutBoard` on the client
// resolves collisions and sizes them, so nothing here has to be trusted.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    topic?: string
    page?: Page
  } | null
  const topic = body?.topic
  const page = body?.page

  if (typeof topic !== "string" || !topic.trim() || !page?.question) {
    return NextResponse.json(
      { error: "topic and page required" },
      { status: 400 },
    )
  }

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
          `Lesson topic: ${topic}\n\n` +
          `This page — "${page.title}" (${page.kind}): ${page.summary}\n` +
          `The question it works through: ${page.question}\n\n` +
          `Grid is ${GRID.cols} columns x ${GRID.rows} rows. Design this page's board.`,
      },
    ],
  })

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no board" }, { status: 502 })
  }

  try {
    return NextResponse.json(JSON.parse(text.text) as Board)
  } catch {
    return NextResponse.json({ error: "invalid board" }, { status: 502 })
  }
}
