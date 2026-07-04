import type { SvgLineEdit } from "./types"

export type ApplyResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

export function applySvgLineEdit(
  svg: string,
  edit: SvgLineEdit,
): ApplyResult {
  const { start_line, end_line, content } = edit
  const lines = svg.split("\n")
  const isInsert = start_line === end_line + 1

  if (isInsert) {
    if (start_line < 1 || start_line > lines.length + 1) {
      return { ok: false, error: "insert position out of range" }
    }
    const next = [...lines]
    next.splice(start_line - 1, 0, ...content.split("\n"))
    return { ok: true, svg: next.join("\n") }
  }

  if (
    start_line < 1 ||
    end_line > lines.length ||
    start_line > end_line
  ) {
    return { ok: false, error: "replace range out of range" }
  }
  const next = [...lines]
  next.splice(
    start_line - 1,
    end_line - start_line + 1,
    ...content.split("\n"),
  )
  return { ok: true, svg: next.join("\n") }
}

export function addLineNumbers(svg: string): string {
  return svg
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n")
}
