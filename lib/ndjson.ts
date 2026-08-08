import { cleanCodeLines } from "./code"
import type { TeacherAction } from "./types"

function coerceAction(value: unknown): TeacherAction | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  switch (v.type) {
    case "speak":
      return typeof v.text === "string" ? { type: "speak", text: v.text } : null
    case "code": {
      const lines = cleanCodeLines(v.lines)
      return lines
        ? {
            type: "code",
            label: typeof v.label === "string" ? v.label : "",
            lines,
          }
        : null
    }
    case "draw":
      if (typeof v.panel === "string" && typeof v.what === "string") {
        return { type: "draw", panel: v.panel, what: v.what }
      }
      if (typeof v.connector === "string") {
        return { type: "draw", connector: v.connector }
      }
      return null
    case "done":
      return { type: "done" }
    default:
      return null
  }
}

export function parseAction(line: string): TeacherAction | null {
  try {
    return coerceAction(JSON.parse(line))
  } catch {
    return null
  }
}

/**
 * One NDJSON value per line, tolerating the trailing partial line.
 *
 * Both streams in the app are NDJSON over SSE — the teacher's actions and a
 * panel's blocks — so the buffering lives here once and each stream supplies
 * only its own per-line parse. A line that doesn't parse is dropped rather than
 * failing the stream: a model mid-sentence is not a reason to lose the lesson.
 */
export class LineParser<T> {
  private buffer = ""

  constructor(private readonly parse: (line: string) => T | null) {}

  private take(line: string, out: T[]): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const value = this.parse(trimmed)
    if (value) out.push(value)
  }

  push(chunk: string): T[] {
    this.buffer += chunk
    const out: T[] = []
    let nl: number
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      this.take(this.buffer.slice(0, nl), out)
      this.buffer = this.buffer.slice(nl + 1)
    }
    return out
  }

  flush(): T[] {
    const out: T[] = []
    this.take(this.buffer, out)
    this.buffer = ""
    return out
  }
}
