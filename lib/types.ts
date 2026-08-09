type DrawAction =
  { type: "draw"; panel: string; what: string } | { type: "draw"; connector: string }

export type TeacherAction =
  | { type: "speak"; text: string }
  | DrawAction
  // Code goes to an HTML pane beside the board, not onto it — see lib/code.ts.
  | { type: "code"; label: string; lines: string[] }
  | { type: "done" }
