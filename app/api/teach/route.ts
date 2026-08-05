import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { sseResponse } from "@/lib/sse"
import { TEACHER_MODEL } from "@/lib/models"
import { TEACHER_SYSTEM } from "@/lib/prompts"
import { describeBoard, type Board } from "@/lib/board"
import { PAGE_KIND, type Page } from "@/lib/lesson"

export const runtime = "nodejs"

interface Body {
  topic: string
  pages: Page[]
  currentIndex: number
  transcript: { role: "user" | "assistant"; text: string }[]
  board: Board
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const pages = body?.pages
  const currentIndex = body?.currentIndex
  const transcript = body?.transcript ?? []
  const board = body?.board

  if (
    !Array.isArray(pages) ||
    typeof currentIndex !== "number" ||
    !pages[currentIndex] ||
    !board
  ) {
    return NextResponse.json({ error: "invalid teach request" }, { status: 400 })
  }

  const current = pages[currentIndex]

  // The outline is given in full so the teacher knows what it does NOT have to
  // cover here. Without it, every page drifts into the next one's material and
  // the lesson says the same thing five times.
  const outline = pages
    .map(
      (p, i) =>
        `${i + 1}. ${p.title}${i === currentIndex ? "  <- you are teaching this page" : ""} — ${p.summary}`,
    )
    .join("\n")

  const { panels, connectors } = describeBoard(board)
  const rule = PAGE_KIND[current.kind].teachingRule

  const context =
    `Lesson topic: ${body?.topic ?? ""}\n\nThe lesson's outline:\n${outline}\n\n` +
    `This page is "${current.title}" (${current.kind}). ` +
    `The question to work through: ${current.question}\n` +
    (rule ? `\n${rule}\n` : "") +
    `\nThis page's whiteboard is empty. These panel ids are the ONLY things you may draw into:\n${panels}\n` +
    (connectors ? `\nAnd these connectors:\n${connectors}\n` : "")

  const messages = [
    { role: "user" as const, content: `System context:\n${context}` },
    ...transcript.map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user" as const,
      content:
        "Teach this page now. Alternate speak and draw so each sentence is followed by the one thing it describes. Cover this page's question properly and leave the rest of the outline alone. Emit exactly one NDJSON turn, ending with done. Stop after done.",
    },
  ]

  async function* gen() {
    const stream = anthropic.messages.stream({
      model: TEACHER_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: TEACHER_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    })
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        yield { event: "text", data: { delta: ev.delta.text } }
      }
    }
    yield { event: "end", data: {} }
  }

  return sseResponse(gen())
}
