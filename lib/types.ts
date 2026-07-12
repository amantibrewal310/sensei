export type DrawAction =
  | { type: "draw"; panel: string; what: string }
  | { type: "draw"; connector: string }

export type TeacherAction =
  | { type: "speak"; text: string }
  | DrawAction
  | { type: "done" }

export function isPanelDraw(
  a: DrawAction,
): a is { type: "draw"; panel: string; what: string } {
  return "panel" in a
}

export interface Step {
  id: string
  label: string
  question: string
}
