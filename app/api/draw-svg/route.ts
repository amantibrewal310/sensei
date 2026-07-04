import { NextResponse } from "next/server"
import { anthropic, sseResponse } from "@/lib/anthropic"
import { SVG_SYSTEM } from "@/lib/prompts"
import { SVG_MODEL } from "@/lib/models"
import { addLineNumbers, applySvgLineEdit } from "@/lib/svg-edit"
import { parseEditsFromBuffer } from "@/lib/svg-parse"

export const runtime = "nodejs"

interface Body {
  instruction: string
  currentSvg: string
  canvasWidth: number
  snapshotPng?: string
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const instruction = body?.instruction
  const currentSvg = body?.currentSvg
  const canvasWidth = body?.canvasWidth
  const snapshotPng = body?.snapshotPng
  if (
    typeof instruction !== "string" ||
    !instruction.trim() ||
    typeof currentSvg !== "string" ||
    typeof canvasWidth !== "number"
  ) {
    return NextResponse.json({ error: "invalid draw request" }, { status: 400 })
  }

  const numbered = addLineNumbers(currentSvg)

  const userText =
    `Current SVG (line-numbered):\n"""\n${numbered}\n"""\n\n` +
    `Canvas width: ${canvasWidth}px. Do not exceed it.\n\n` +
    `Instruction:\n${instruction}\n\n` +
    `Return only the JSON edits object. List edits highest line number first.`

  const content = snapshotPng
    ? [
        {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/png" as const,
            data: snapshotPng.replace(/^data:image\/png;base64,/, ""),
          },
        },
        { type: "text" as const, text: userText },
      ]
    : userText

  async function* gen() {
    const stream = anthropic.messages.stream({
      model: SVG_MODEL,
      max_tokens: 8000,
      system: [
        { type: "text", text: SVG_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content }],
    })

    let buffer = ""
    let emitted = 0
    // currentSvg is validated as a string above; the cast is needed because
    // TS control-flow narrowing of the outer const does not extend into this
    // nested async generator closure.
    let workingSvg = currentSvg as string

    for await (const ev of stream) {
      if (
        ev.type === "content_block_delta" &&
        ev.delta.type === "text_delta"
      ) {
        buffer += ev.delta.text
        const edits = parseEditsFromBuffer(buffer)
        // emit all but the last (last may still be streaming)
        while (emitted < edits.length - 1) {
          const edit = edits[emitted]
          const applied = applySvgLineEdit(workingSvg, edit)
          if (applied.ok) {
            workingSvg = applied.svg
            yield { event: "edit", data: edit }
          }
          emitted++
        }
      }
    }
    // flush the final edit
    const finalEdits = parseEditsFromBuffer(buffer)
    while (emitted < finalEdits.length) {
      const edit = finalEdits[emitted]
      const applied = applySvgLineEdit(workingSvg, edit)
      if (applied.ok) {
        workingSvg = applied.svg
        yield { event: "edit", data: edit }
      }
      emitted++
    }
    yield { event: "done", data: { final_svg: workingSvg } }
  }

  return sseResponse(gen())
}
