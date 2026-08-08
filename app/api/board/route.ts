import { NextResponse } from "next/server"
import { z } from "zod"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { BOARD_SYSTEM } from "@/lib/prompts"
import { BoardJsonSchema, BoardSchema, GRID } from "@/lib/board"
import { PageSchema, Topic } from "@/lib/lesson"
import { readBody, safeJson } from "@/lib/request"
import { withGuard } from "@/lib/guard"
import { recordModelUsage } from "@/lib/usage"

export const runtime = "nodejs"
// Vercel Hobby: 10s default, 60s ceiling. See app/api/plan/route.ts.
export const maxDuration = 60

// Named once: withGuard puts it in the log line, recordUsage puts it in
// `usage_event.route`, and the spend cap reads that column.
const ROUTE = "board"

const BoardRequest = z.object({ topic: Topic, page: PageSchema })

// One board per page, designed when the page is about to be taught. Doing it per
// page rather than once for the lesson is what lets a page hold two roomy panels
// instead of a twelfth of the canvas each.
//
// The slots come back as the model asked for them; `layoutBoard` on the client
// resolves collisions and sizes them, so nothing here has to be trusted.
export const POST = withGuard(ROUTE, async (req, user) => {
  const body = await readBody(req, BoardRequest)
  if (!body.ok) return body.response
  const { topic, page } = body.data

  const started = Date.now()
  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    // Thinking is on by default on this model, and max_tokens covers thinking
    // plus response text. See app/api/plan/route.ts.
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    // Cached: measured at 1171 tokens with the JSON schema included, and this
    // route runs once per page. The prefix is byte-stable — the only
    // interpolations are GRID.cols and GRID.rows, both module constants.
    system: [
      {
        type: "text",
        text: BOARD_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
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
  await recordModelUsage({
    route: ROUTE,
    userId: user.id,
    model: TEACHER_MODEL,
    usage: msg.usage,
    ms: Date.now() - started,
  })

  if (msg.stop_reason === "refusal") {
    return NextResponse.json({ error: "page declined" }, { status: 422 })
  }

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no board" }, { status: 502 })
  }

  // Parsed, not cast. `output_config.format` makes malformed output unlikely
  // rather than impossible, and these numbers are about to become an occupancy
  // grid and a set of rectangles — /api/plan already ran its output through
  // zod, and this route was the one that did not.
  const board = BoardSchema.safeParse(safeJson(text.text))
  if (!board.success) {
    return NextResponse.json({ error: "invalid board" }, { status: 502 })
  }
  return NextResponse.json(board.data)
})
