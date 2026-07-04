export type TeacherAction =
  | { type: "plan"; intent: string }
  | { type: "speak"; text: string }
  | { type: "draw"; instruction: string }
  | { type: "done" }

export interface Step {
  id: string
  label: string
  question: string
}

export interface SvgLineEdit {
  start_line: number
  end_line: number
  content: string
}
