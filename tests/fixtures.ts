import type { Block, Item } from "@/lib/blocks"
import type { Board } from "@/lib/board"
import type { Page } from "@/lib/lesson"

// The post-parse shape of an `Item` — every optional field already filled in by
// the schema. Written out in each test file, a new required field on `Item`
// broke three files at once and had to be fixed three times. The rest of the
// file exists for the same reason: one learner, one page, one board, shared by
// every suite that needs one, so a shape change breaks one file loudly instead
// of three quietly.

export const item = (text: string): Item => ({
  text,
  color: "black",
  emphasis: false,
})

export const items = (...texts: string[]) => texts.map(item)

export const row = (...texts: string[]): Block => ({
  kind: "row",
  items: items(...texts),
})

/** An approved learner, as the session mock hands one to the real guard. */
export const APPROVED = {
  id: "u_test",
  email: "learner@example.com",
  status: "approved",
  role: "user",
}

export const ADMIN = {
  id: "u_admin",
  email: "admin@example.com",
  status: "approved",
  role: "admin",
}

/** The limit query's row when nothing has been spent this month. */
export const CLEAR_LIMITS = { user_micros: "0", global_micros: "0", recent: 0 }

export const PAGE: Page = {
  id: "page-1",
  title: "Token bucket",
  summary: "permits that refill",
  question: "how does it admit requests?",
  kind: "algorithm",
}

export const BOARD: Board = {
  panels: [
    {
      id: "bucket",
      title: "The bucket",
      col: 0,
      row: 0,
      colSpan: 1,
      rowSpan: 1,
      note: "",
    },
  ],
  connectors: [],
}

/** A JSON POST as a route receives one. */
export function post(
  route: (req: Request) => Promise<Response>,
  body: unknown,
): Promise<Response> {
  return route(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}
