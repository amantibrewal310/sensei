import type { TeacherAction } from "./types"

function coerceAction(value: unknown): TeacherAction | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  switch (v.type) {
    case "speak":
      return typeof v.text === "string" ? { type: "speak", text: v.text } : null
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

function parseLine(line: string): TeacherAction | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return coerceAction(JSON.parse(trimmed))
  } catch {
    return null
  }
}

export class NdjsonActionParser {
  private buffer = ""

  push(chunk: string): TeacherAction[] {
    this.buffer += chunk
    const actions: TeacherAction[] = []
    let nl: number
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      const action = parseLine(line)
      if (action) actions.push(action)
    }
    return actions
  }

  flush(): TeacherAction[] {
    const action = parseLine(this.buffer)
    this.buffer = ""
    return action ? [action] : []
  }
}
