import type { SvgLineEdit } from "./types"

function isEdit(v: unknown): v is SvgLineEdit {
  if (!v || typeof v !== "object") return false
  const e = v as Record<string, unknown>
  return (
    typeof e.start_line === "number" &&
    typeof e.end_line === "number" &&
    typeof e.content === "string"
  )
}

export function parseEditsFromBuffer(buffer: string): SvgLineEdit[] {
  const start = buffer.indexOf("[")
  if (start === -1) return []

  const edits: SvgLineEdit[] = []
  let depth = 0
  let objStart = -1
  let inString = false
  let escaped = false

  for (let i = start + 1; i < buffer.length; i++) {
    const ch = buffer[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === "{") {
      if (depth === 0) objStart = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && objStart !== -1) {
        const slice = buffer.slice(objStart, i + 1)
        try {
          const parsed = JSON.parse(slice)
          if (isEdit(parsed)) edits.push(parsed)
        } catch {
          /* skip */
        }
        objStart = -1
      }
    } else if (ch === "]" && depth === 0) {
      break
    }
  }
  return edits
}
