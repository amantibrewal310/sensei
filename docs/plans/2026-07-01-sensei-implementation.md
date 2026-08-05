# sensei Implementation Plan

> **STATUS (2026-07-22): COMPLETE.** Every task below was implemented and committed (all 44 tests
> pass, `npm run build` and `npx tsc --noEmit` are clean, pushed to `origin/build`). Two parts of
> this plan were then **deliberately superseded** — the checked boxes record that the work was done,
> not that the code still exists in this form:
>
> - **SVG freehand drawing → planned board + packed panels** (commit `f589efc`). Tasks 1.2, 1.4,
>   2.4, and Phase 3 (`lib/svg-edit.ts`, `lib/svg-parse.ts`, `/api/draw-svg`, `SvgCanvas`,
>   `useDrawRequest`, dev draw page) were replaced by `lib/layout.ts`, `lib/pack.ts`,
>   `lib/shapes.ts`, `components/Board.tsx` (tldraw), `/api/board`, and `/api/draw-panel`.
>   Code owns all geometry; the LLM never picks a pixel.
> - **OpenAI Realtime voice (mic, VAD, barge-in) → output-only TTS** (commit `2b06fe7`). Task 2.5
>   and Phase 4 (`/api/realtime-token`, `voice/`, dev voice page, the "Start voice" button) were
>   replaced by `/api/speak` + `lib/narrator.ts`. No microphone access ever; interruption is
>   text-only via the ask box.
>
> The README describes the final architecture; git history is the authoritative record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single Next.js app where a user types a topic and a teacher agent speaks and draws on an SVG canvas in real time, step by step, with voice/text interruption.

**Architecture:** One Next.js app. The browser holds session state and drives the teaching loop; the server is stateless route handlers. Claude (`claude-opus-4-8`) is the teacher brain and the SVG-diff agent; both stream. Voice is OpenAI Realtime (mic, playback, VAD, barge-in). The teacher emits NDJSON actions (`plan`/`speak`/`draw`/`done`) parsed incrementally; drawings are line-level SVG edits applied with an animation delay.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, `@anthropic-ai/sdk`, `zod`, `vitest`, OpenAI Realtime API (WebRTC).

## Global Constraints

- Reasoning model (teacher + SVG agent): `claude-opus-4-8` (exact string). Never a different Claude model unless a task says so.
- All Claude calls **stream**. Teacher and SVG routes emit **Server-Sent Events (SSE)**.
- Teacher output is **NDJSON** (one JSON object per line) parsed as text — NOT structured outputs (must parse line-by-line as it streams).
- Turn actions are exactly: `plan`, `speak`, `draw`, `done`. No other action types.
- SVG line numbers are **1-indexed**.
- Secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) live only in server code / `.env.local`; the browser gets an **ephemeral** Realtime key.
- Path import alias: `@/*` → repo root.
- Test runner: `vitest`. Run a single file with `npx vitest run <path>`.
- Commit after every task with a Conventional Commit message.

---

## File Structure

```
lib/
  types.ts                 # shared types (TeacherAction, Step, SvgLineEdit)
  models.ts                # model id constants
  ndjson.ts                # NdjsonActionParser (incremental)
  svg-edit.ts              # applySvgLineEdit, addLineNumbers
  svg-parse.ts             # parseEditsFromBuffer (partial JSON edits)
  plan-schema.ts           # zod schema + parsePlan
  anthropic.ts             # Anthropic client + shared SSE helper
  prompts.ts               # teacher + svg-agent system prompts
app/
  api/plan/route.ts        # topic -> Step[]
  api/teach/route.ts       # one turn -> NDJSON actions (SSE)
  api/draw-svg/route.ts    # instruction + svg -> edits (SSE)
  api/realtime-token/route.ts  # mint ephemeral OpenAI Realtime key
  page.tsx                 # home: topic input
  learn/page.tsx           # canvas + progress strip + text input
components/
  SvgCanvas.tsx            # renders the SVG string
  ProgressStrip.tsx        # "step N of M"
hooks/
  useDrawRequest.ts        # consume /api/draw-svg SSE, animate edits
  useTeachingSession.ts    # drive plan -> teach -> speak+draw -> advance
voice/
  types.ts                 # VoiceLayer interface
  realtime.ts              # createRealtimeVoice() (WebRTC)
tests/                     # vitest specs (co-located under tests/)
```

---

# Phase 0 — Scaffold & Tooling

### Task 0.1: Scaffold the Next.js app, deps, vitest, shared types

**Files:**
- Create: whole Next.js app (via `create-next-app`), `vitest.config.mts`, `lib/types.ts`, `lib/models.ts`, `.env.local.example`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `TeacherAction`, `Step`, `SvgLineEdit` types; `TEACHER_MODEL`, `SVG_MODEL` constants.

- [x] **Step 1: Scaffold Next.js into the existing repo (which already has README/LICENSE/docs).**

`create-next-app` refuses a non-empty dir, so scaffold into a temp folder and move files up.

```bash
cd ~/Workspace/Personal/Projects/sensei
npx create-next-app@latest .scaffold --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --disable-git
# move scaffold contents up (keep our README/LICENSE/docs/.gitignore)
rsync -a --exclude=.git --exclude=README.md --exclude=.gitignore .scaffold/ .
rm -rf .scaffold
```

- [x] **Step 2: Install runtime + test deps.**

```bash
npm install @anthropic-ai/sdk zod
npm install -D vitest
```

- [x] **Step 3: Add vitest config and a test script.**

Create `vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
})
```

In `package.json` add to `"scripts"`: `"test": "vitest run"`.

- [x] **Step 4: Create shared types and model constants.**

Create `lib/types.ts`:

```ts
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
```

Create `lib/models.ts`:

```ts
export const TEACHER_MODEL = "claude-opus-4-8"
export const SVG_MODEL = "claude-opus-4-8"
```

- [x] **Step 5: Add `.env.local.example`.**

Create `.env.local.example`:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
# optional overrides
OPENAI_REALTIME_MODEL=gpt-realtime
```

- [x] **Step 6: Verify the app builds and commit.**

```bash
npm run build
git add -A
git commit -m "chore: scaffold Next.js app, vitest, shared types"
```

Expected: build succeeds (default Next.js page compiles).

---

# Phase 1 — Pure Core Units (TDD)

These are the highest-value, fully-testable seams. Write tests first.

### Task 1.1: NDJSON incremental action parser

**Files:**
- Create: `lib/ndjson.ts`, `tests/ndjson.test.ts`

**Interfaces:**
- Consumes: `TeacherAction` from `lib/types.ts`.
- Produces: `class NdjsonActionParser { push(chunk: string): TeacherAction[]; flush(): TeacherAction[] }`. `push` returns actions for every **complete** line seen so far (buffering a trailing partial line); `flush` parses any leftover buffered line. Lines that are not valid actions are skipped silently.

- [x] **Step 1: Write failing tests.**

Create `tests/ndjson.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { NdjsonActionParser } from "@/lib/ndjson"

describe("NdjsonActionParser", () => {
  it("parses whole lines from one chunk", () => {
    const p = new NdjsonActionParser()
    const out = p.push(
      '{"type":"speak","text":"hi"}\n{"type":"done"}\n',
    )
    expect(out).toEqual([
      { type: "speak", text: "hi" },
      { type: "done" },
    ])
  })

  it("buffers a partial line across chunks", () => {
    const p = new NdjsonActionParser()
    expect(p.push('{"type":"spe')).toEqual([])
    expect(p.push('ak","text":"yo"}\n')).toEqual([
      { type: "speak", text: "yo" },
    ])
  })

  it("flush parses a final unterminated line", () => {
    const p = new NdjsonActionParser()
    p.push('{"type":"draw","instruction":"a box"}')
    expect(p.push("")).toEqual([])
    expect(p.flush()).toEqual([
      { type: "draw", instruction: "a box" },
    ])
  })

  it("skips malformed and unknown lines", () => {
    const p = new NdjsonActionParser()
    const out = p.push(
      'not json\n{"type":"nope"}\n{"type":"plan","intent":"teach"}\n',
    )
    expect(out).toEqual([{ type: "plan", intent: "teach" }])
  })
})
```

- [x] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run tests/ndjson.test.ts`
Expected: FAIL — `NdjsonActionParser` not found.

- [x] **Step 3: Implement the parser.**

Create `lib/ndjson.ts`:

```ts
import type { TeacherAction } from "./types"

function coerceAction(value: unknown): TeacherAction | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  switch (v.type) {
    case "plan":
      return typeof v.intent === "string"
        ? { type: "plan", intent: v.intent }
        : null
    case "speak":
      return typeof v.text === "string"
        ? { type: "speak", text: v.text }
        : null
    case "draw":
      return typeof v.instruction === "string"
        ? { type: "draw", instruction: v.instruction }
        : null
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
```

- [x] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run tests/ndjson.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit.**

```bash
git add lib/ndjson.ts tests/ndjson.test.ts
git commit -m "feat: incremental NDJSON action parser"
```

---

### Task 1.2: applySvgLineEdit

**Files:**
- Create: `lib/svg-edit.ts`, `tests/svg-edit.test.ts`

**Interfaces:**
- Consumes: `SvgLineEdit` from `lib/types.ts`.
- Produces:
  - `applySvgLineEdit(svg: string, edit: SvgLineEdit): { ok: true; svg: string } | { ok: false; error: string }` — 1-indexed. Replaces lines `[start_line, end_line]` inclusive with `content`. An **insertion** is `start_line === end_line + 1` (insert `content` before `start_line`; `start_line` may be `lines.length + 1` to append). Out-of-range returns `{ ok: false }`.
  - `addLineNumbers(svg: string): string` — prefixes each line with `"<n>: "` (1-indexed).

- [x] **Step 1: Write failing tests.**

Create `tests/svg-edit.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { applySvgLineEdit, addLineNumbers } from "@/lib/svg-edit"

const svg = "<svg>\n<a/>\n<b/>\n</svg>"

describe("applySvgLineEdit", () => {
  it("replaces a single line", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 2,
      content: "<x/>",
    })
    expect(r).toEqual({ ok: true, svg: "<svg>\n<x/>\n<b/>\n</svg>" })
  })

  it("replaces a range with multi-line content", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 3,
      content: "<x/>\n<y/>",
    })
    expect(r).toEqual({ ok: true, svg: "<svg>\n<x/>\n<y/>\n</svg>" })
  })

  it("inserts before a line (start = end + 1)", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 2,
      end_line: 1,
      content: "<ins/>",
    })
    expect(r).toEqual({
      ok: true,
      svg: "<svg>\n<ins/>\n<a/>\n<b/>\n</svg>",
    })
  })

  it("appends at end (start = length + 1)", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 5,
      end_line: 4,
      content: "<end/>",
    })
    expect(r).toEqual({
      ok: true,
      svg: "<svg>\n<a/>\n<b/>\n</svg>\n<end/>",
    })
  })

  it("errors on out-of-range", () => {
    const r = applySvgLineEdit(svg, {
      start_line: 10,
      end_line: 10,
      content: "<z/>",
    })
    expect(r.ok).toBe(false)
  })
})

describe("addLineNumbers", () => {
  it("prefixes 1-indexed line numbers", () => {
    expect(addLineNumbers("a\nb")).toBe("1: a\n2: b")
  })
})
```

- [x] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run tests/svg-edit.test.ts`
Expected: FAIL — functions not defined.

- [x] **Step 3: Implement.**

Create `lib/svg-edit.ts`:

```ts
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
```

- [x] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run tests/svg-edit.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit.**

```bash
git add lib/svg-edit.ts tests/svg-edit.test.ts
git commit -m "feat: applySvgLineEdit and addLineNumbers"
```

---

### Task 1.3: Plan schema (zod) + parsePlan

**Files:**
- Create: `lib/plan-schema.ts`, `tests/plan-schema.test.ts`

**Interfaces:**
- Consumes: `Step` from `lib/types.ts`.
- Produces:
  - `PlanJsonSchema` — a JSON Schema object usable by Claude structured outputs.
  - `parsePlan(data: unknown): Step[]` — validates with zod; throws on invalid; assigns `id` = `step-1`, `step-2`, … in order.

- [x] **Step 1: Write failing tests.**

Create `tests/plan-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parsePlan } from "@/lib/plan-schema"

describe("parsePlan", () => {
  it("validates and assigns sequential ids", () => {
    const steps = parsePlan({
      steps: [
        { label: "Why", question: "Why does X exist?" },
        { label: "How", question: "How does X work?" },
        { label: "Limits", question: "When does X break?" },
      ],
    })
    expect(steps).toEqual([
      { id: "step-1", label: "Why", question: "Why does X exist?" },
      { id: "step-2", label: "How", question: "How does X work?" },
      { id: "step-3", label: "Limits", question: "When does X break?" },
    ])
  })

  it("throws when steps missing or empty", () => {
    expect(() => parsePlan({ steps: [] })).toThrow()
    expect(() => parsePlan({})).toThrow()
  })
})
```

- [x] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run tests/plan-schema.test.ts`
Expected: FAIL — `parsePlan` not found.

- [x] **Step 3: Implement.**

Create `lib/plan-schema.ts`:

```ts
import { z } from "zod"
import type { Step } from "./types"

const RawStep = z.object({
  label: z.string().min(1),
  question: z.string().min(1),
})

const RawPlan = z.object({
  steps: z.array(RawStep).min(1).max(6),
})

export const PlanJsonSchema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          question: { type: "string" },
        },
        required: ["label", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const

export function parsePlan(data: unknown): Step[] {
  const parsed = RawPlan.parse(data)
  return parsed.steps.map((s, i) => ({
    id: `step-${i + 1}`,
    label: s.label,
    question: s.question,
  }))
}
```

- [x] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run tests/plan-schema.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit.**

```bash
git add lib/plan-schema.ts tests/plan-schema.test.ts
git commit -m "feat: plan zod schema and parsePlan"
```

---

### Task 1.4: parseEditsFromBuffer (partial JSON edits)

**Files:**
- Create: `lib/svg-parse.ts`, `tests/svg-parse.test.ts`

**Interfaces:**
- Consumes: `SvgLineEdit` from `lib/types.ts`.
- Produces: `parseEditsFromBuffer(buffer: string): SvgLineEdit[]` — given a possibly-incomplete JSON string of the shape `{"edits":[ {..}, {..}, ... ]}`, returns every **complete** edit object decoded so far (ignores a trailing partial object). Only returns objects with numeric `start_line`/`end_line` and string `content`.

- [x] **Step 1: Write failing tests.**

Create `tests/svg-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parseEditsFromBuffer } from "@/lib/svg-parse"

describe("parseEditsFromBuffer", () => {
  it("returns complete edits from a full buffer", () => {
    const buf =
      '{"edits":[{"start_line":1,"end_line":1,"content":"<a/>"},' +
      '{"start_line":2,"end_line":2,"content":"<b/>"}]}'
    expect(parseEditsFromBuffer(buf)).toEqual([
      { start_line: 1, end_line: 1, content: "<a/>" },
      { start_line: 2, end_line: 2, content: "<b/>" },
    ])
  })

  it("ignores a trailing incomplete edit", () => {
    const buf =
      '{"edits":[{"start_line":1,"end_line":1,"content":"<a/>"},' +
      '{"start_line":2,"end_line":2,"content":"<b'
    expect(parseEditsFromBuffer(buf)).toEqual([
      { start_line: 1, end_line: 1, content: "<a/>" },
    ])
  })

  it("returns [] when no complete edit yet", () => {
    expect(parseEditsFromBuffer('{"edits":[{"start_l')).toEqual([])
  })
})
```

- [x] **Step 2: Run tests to verify they fail.**

Run: `npx vitest run tests/svg-parse.test.ts`
Expected: FAIL — function not defined.

- [x] **Step 3: Implement (brace-scan for complete objects inside the edits array).**

Create `lib/svg-parse.ts`:

```ts
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
```

- [x] **Step 4: Run tests to verify they pass.**

Run: `npx vitest run tests/svg-parse.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit.**

```bash
git add lib/svg-parse.ts tests/svg-parse.test.ts
git commit -m "feat: parseEditsFromBuffer for incremental SVG edits"
```

---

# Phase 2 — Server Routes (Claude + OpenAI token)

### Task 2.1: Anthropic client, prompts, SSE helper

**Files:**
- Create: `lib/anthropic.ts`, `lib/prompts.ts`

**Interfaces:**
- Produces:
  - `anthropic` — a singleton `Anthropic` client.
  - `sseResponse(gen: AsyncGenerator<{ event: string; data: unknown }>): Response` — wraps an async generator of `{event,data}` into a `text/event-stream` `Response`.
  - `TEACHER_SYSTEM`, `SVG_SYSTEM` prompt strings.

- [x] **Step 1: Create the client + SSE helper.**

Create `lib/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export function sseResponse(
  gen: AsyncGenerator<{ event: string; data: unknown }>,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const { event, data } of gen) {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          )
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              message: err instanceof Error ? err.message : "stream error",
            })}\n\n`,
          ),
        )
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
```

- [x] **Step 2: Create prompts.**

Create `lib/prompts.ts`:

```ts
export const TEACHER_SYSTEM = `You are a curiosity-first teacher. You teach one QUESTION at a time by speaking and drawing on a shared canvas.

Raise a question in the learner's mind, then answer it — build intuition, use analogies, avoid dry lecturing.

OUTPUT FORMAT — NDJSON. Emit one JSON object per line. No prose outside the JSON. The ONLY allowed shapes:
{"type":"plan","intent":"teach"}
{"type":"speak","text":"<one or two sentences to say out loud>"}
{"type":"draw","instruction":"<plain-English description of what to add to the canvas>"}
{"type":"done"}

Rules for ONE turn:
- Start with exactly one "plan" line.
- Then one or more "speak" lines and AT MOST one "draw" line. Put the "speak" you want said while drawing BEFORE the "draw" line.
- End with exactly one "done" line.
- "draw" describes WHAT to draw in words (e.g. "a single-threaded call stack with a queue beside it, labeled"), never SVG or coordinates.
- Keep each turn small — one idea. The client advances to the next turn automatically.`

export const SVG_SYSTEM = `You edit an SVG scene to satisfy a drawing instruction. You are given the current SVG with line numbers and a snapshot image.

Return ONLY a JSON object of this exact shape:
{"edits":[{"start_line":<int>,"end_line":<int>,"content":"<svg fragment>"}]}

Edit semantics (1-indexed):
- Replace lines start_line..end_line (inclusive) with content.
- To INSERT before a line, set start_line = end_line + 1 (content goes before start_line).
- List edits from HIGHEST line numbers to LOWEST so earlier edits don't shift later line numbers.

Drawing rules:
- Keep the existing <svg> root; add/modify children.
- Use clear labels, readable font sizes, and simple shapes.
- Never place elements outside the given canvas width.`
```

- [x] **Step 3: Commit.**

```bash
git add lib/anthropic.ts lib/prompts.ts
git commit -m "feat: anthropic client, SSE helper, system prompts"
```

_No unit test — this is glue validated by the routes that consume it (Tasks 2.2–2.4)._

---

### Task 2.2: `POST /api/plan`

**Files:**
- Create: `app/api/plan/route.ts`

**Interfaces:**
- Consumes: `anthropic`, `TEACHER_MODEL`, `PlanJsonSchema`, `parsePlan`.
- Produces: `POST /api/plan` with body `{ topic: string }` → JSON `{ steps: Step[] }`.

- [x] **Step 1: Implement the route (structured output, non-streaming — plan is short).**

Create `app/api/plan/route.ts`:

```ts
import { NextResponse } from "next/server"
import { anthropic } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import { PlanJsonSchema, parsePlan } from "@/lib/plan-schema"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { topic } = await req.json().catch(() => ({ topic: "" }))
  if (typeof topic !== "string" || !topic.trim()) {
    return NextResponse.json({ error: "topic required" }, { status: 400 })
  }

  const msg = await anthropic.messages.create({
    model: TEACHER_MODEL,
    max_tokens: 2000,
    system:
      "You design a short curiosity-first learning path: 3-4 questions covering why / how / a surprise / limits.",
    output_config: {
      format: { type: "json_schema", schema: PlanJsonSchema },
    },
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\nReturn 3-4 teaching questions as JSON.`,
      },
    ],
  })

  const text = msg.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") {
    return NextResponse.json({ error: "no plan" }, { status: 502 })
  }
  try {
    const steps = parsePlan(JSON.parse(text.text))
    return NextResponse.json({ steps })
  } catch {
    return NextResponse.json({ error: "invalid plan" }, { status: 502 })
  }
}
```

- [x] **Step 2: Manual verify with a real key.**

```bash
# with ANTHROPIC_API_KEY set in .env.local and `npm run dev` running:
curl -s localhost:3000/api/plan -X POST -H 'content-type: application/json' \
  -d '{"topic":"the javascript event loop"}' | head -c 600
```

Expected: JSON `{"steps":[{"id":"step-1",...}, ...]}` with 3–4 items.

- [x] **Step 3: Commit.**

```bash
git add app/api/plan/route.ts
git commit -m "feat: /api/plan returns a step plan for a topic"
```

---

### Task 2.3: `POST /api/teach` (SSE NDJSON)

**Files:**
- Create: `app/api/teach/route.ts`

**Interfaces:**
- Consumes: `anthropic`, `TEACHER_MODEL`, `TEACHER_SYSTEM`, `sseResponse`.
- Produces: `POST /api/teach` with body `{ steps: Step[]; currentIndex: number; transcript: {role:"user"|"assistant"; text:string}[] }` → SSE stream emitting `event: text` with `{ delta: string }` for each token chunk, then `event: end`. (The client parses NDJSON from the concatenated deltas.)

- [x] **Step 1: Implement the route.**

Create `app/api/teach/route.ts`:

```ts
import { anthropic, sseResponse, TEACHER_SYSTEM } from "@/lib/anthropic"
import { TEACHER_MODEL } from "@/lib/models"
import type { Step } from "@/lib/types"

export const runtime = "nodejs"

interface Body {
  steps: Step[]
  currentIndex: number
  transcript: { role: "user" | "assistant"; text: string }[]
}

export async function POST(req: Request) {
  const { steps, currentIndex, transcript } = (await req.json()) as Body
  const current = steps[currentIndex]
  const upcoming = steps
    .slice(currentIndex + 1)
    .map((s, i) => `Q${currentIndex + 2 + i} (${s.label}): ${s.question}`)
    .join("\n")

  const context =
    `Current question (Q${currentIndex + 1}, ${current.label}): ${current.question}\n` +
    (upcoming ? `Upcoming:\n${upcoming}\n` : "This is the final question.\n")

  const messages = [
    { role: "user" as const, content: `System context:\n${context}` },
    ...transcript.map((t) => ({ role: t.role, content: t.text })),
    {
      role: "user" as const,
      content:
        "Teach this question now. Emit exactly one NDJSON turn (plan, speak, optional draw, done). Stop after done.",
    },
  ]

  async function* gen() {
    const stream = anthropic.messages.stream({
      model: TEACHER_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [
        { type: "text", text: TEACHER_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages,
    })
    for await (const ev of stream) {
      if (
        ev.type === "content_block_delta" &&
        ev.delta.type === "text_delta"
      ) {
        yield { event: "text", data: { delta: ev.delta.text } }
      }
    }
    yield { event: "end", data: {} }
  }

  return sseResponse(gen())
}
```

- [x] **Step 2: Manual verify.**

```bash
curl -N -s localhost:3000/api/teach -X POST -H 'content-type: application/json' \
  -d '{"steps":[{"id":"step-1","label":"Why","question":"Why does JS need an event loop?"}],"currentIndex":0,"transcript":[]}' | head -c 800
```

Expected: `event: text` lines whose concatenated `delta`s form NDJSON action lines, ending with `event: end`.

- [x] **Step 3: Commit.**

```bash
git add app/api/teach/route.ts
git commit -m "feat: /api/teach streams NDJSON teaching actions over SSE"
```

---

### Task 2.4: `POST /api/draw-svg` (SSE edits)

**Files:**
- Create: `app/api/draw-svg/route.ts`

**Interfaces:**
- Consumes: `anthropic`, `SVG_MODEL`, `SVG_SYSTEM`, `sseResponse`, `addLineNumbers`, `parseEditsFromBuffer`, `applySvgLineEdit`.
- Produces: `POST /api/draw-svg` with body `{ instruction: string; currentSvg: string; canvasWidth: number; snapshotPng?: string }` → SSE: `event: edit` with `SvgLineEdit` for each applied edit (in stream order), then `event: done` with `{ final_svg }`.

- [x] **Step 1: Implement the route.**

Create `app/api/draw-svg/route.ts`:

```ts
import { anthropic, sseResponse, SVG_SYSTEM } from "@/lib/anthropic"
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
  const { instruction, currentSvg, canvasWidth, snapshotPng } =
    (await req.json()) as Body
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
    let workingSvg = currentSvg

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
```

- [x] **Step 2: Manual verify.**

```bash
curl -N -s localhost:3000/api/draw-svg -X POST -H 'content-type: application/json' \
  -d '{"instruction":"draw a labeled box in the top-left","currentSvg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 600\"></svg>","canvasWidth":800}' | head -c 800
```

Expected: one or more `event: edit` lines, then `event: done` with `final_svg`.

- [x] **Step 3: Commit.**

```bash
git add app/api/draw-svg/route.ts
git commit -m "feat: /api/draw-svg streams applied SVG line edits over SSE"
```

---

### Task 2.5: `GET /api/realtime-token`

**Files:**
- Create: `app/api/realtime-token/route.ts`

**Interfaces:**
- Produces: `GET /api/realtime-token` → JSON containing an **ephemeral** OpenAI Realtime client secret + model. The standing `OPENAI_API_KEY` is never returned.

> NOTE FOR IMPLEMENTER: The OpenAI Realtime ephemeral-session endpoint and model id evolve. Verify the exact endpoint (`POST https://api.openai.com/v1/realtime/sessions`) and current model against the OpenAI Realtime docs before relying on this in production. The shape below is the common form.

- [x] **Step 1: Implement.**

Create `app/api/realtime-token/route.ts`:

```ts
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET() {
  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime"
  const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, voice: "alloy" }),
  })
  if (!res.ok) {
    return NextResponse.json(
      { error: `realtime session failed: ${res.status}` },
      { status: 502 },
    )
  }
  const data = await res.json()
  return NextResponse.json({ client_secret: data.client_secret, model })
}
```

- [x] **Step 2: Manual verify.**

```bash
curl -s localhost:3000/api/realtime-token | head -c 400
```

Expected: JSON with a `client_secret` (ephemeral) and `model`.

- [x] **Step 3: Commit.**

```bash
git add app/api/realtime-token/route.ts
git commit -m "feat: /api/realtime-token mints ephemeral OpenAI Realtime key"
```

---

# Phase 3 — Canvas & Drawing

### Task 3.1: SvgCanvas component

**Files:**
- Create: `components/SvgCanvas.tsx`

**Interfaces:**
- Produces: `<SvgCanvas svg={string} />` — renders the raw SVG string full-bleed; also exposes a way to snapshot to PNG in Task 3.2 (via a ref forwarding the rendered `<svg>` bounding container). For simplicity it renders via `dangerouslySetInnerHTML` inside a sized div.

- [x] **Step 1: Implement.**

Create `components/SvgCanvas.tsx`:

```tsx
"use client"

export function SvgCanvas({ svg }: { svg: string }) {
  return (
    <div
      className="h-full w-full bg-white"
      // svg is generated by our own SVG agent (server-side), not user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
```

- [x] **Step 2: Commit.**

```bash
git add components/SvgCanvas.tsx
git commit -m "feat: SvgCanvas renders the scene SVG"
```

_Validated visually in Task 3.3._

---

### Task 3.2: useDrawRequest hook (consume SSE, animate)

**Files:**
- Create: `hooks/useDrawRequest.ts`

**Interfaces:**
- Consumes: `applySvgLineEdit` (`lib/svg-edit`), `SvgLineEdit` (`lib/types`).
- Produces: `useDrawRequest({ getSvg, setSvg, canvasWidth })` → `{ draw(instruction: string, snapshotPng?: string): Promise<void> }`. Calls `/api/draw-svg`, applies each streamed `edit` to the working SVG with a ~500ms delay between edits (calling `setSvg` after each), resolves when `done`.

- [x] **Step 1: Implement.**

Create `hooks/useDrawRequest.ts`:

```ts
"use client"

import { useCallback } from "react"
import { applySvgLineEdit } from "@/lib/svg-edit"
import type { SvgLineEdit } from "@/lib/types"

const DELAY_MS = 500

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function useDrawRequest(opts: {
  getSvg: () => string
  setSvg: (svg: string) => void
  canvasWidth: number
}) {
  const { getSvg, setSvg, canvasWidth } = opts

  const draw = useCallback(
    async (instruction: string, snapshotPng?: string) => {
      let working = getSvg()
      const res = await fetch("/api/draw-svg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          currentSvg: working,
          canvasWidth,
          snapshotPng,
        }),
      })
      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      const handle = async (event: string, data: string) => {
        if (event === "edit") {
          const edit = JSON.parse(data) as SvgLineEdit
          const applied = applySvgLineEdit(working, edit)
          if (applied.ok) {
            working = applied.svg
            setSvg(working)
            await delay(DELAY_MS)
          }
        } else if (event === "done") {
          const { final_svg } = JSON.parse(data)
          if (final_svg) {
            working = final_svg
            setSvg(working)
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split("\n\n")
        buf = frames.pop() ?? ""
        for (const frame of frames) {
          const evLine = frame.split("\n").find((l) => l.startsWith("event: "))
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "))
          if (evLine && dataLine) {
            await handle(evLine.slice(7), dataLine.slice(6))
          }
        }
      }
    },
    [getSvg, setSvg, canvasWidth],
  )

  return { draw }
}
```

- [x] **Step 2: Commit.**

```bash
git add hooks/useDrawRequest.ts
git commit -m "feat: useDrawRequest consumes draw SSE and animates edits"
```

---

### Task 3.3: Dev page to validate drawing end-to-end

**Files:**
- Create: `app/dev/draw/page.tsx`

**Interfaces:**
- Consumes: `SvgCanvas`, `useDrawRequest`.
- Produces: a throwaway page with a text box + "Draw" button that draws onto a starter SVG. Used to eyeball the animation.

- [x] **Step 1: Implement.**

Create `app/dev/draw/page.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { SvgCanvas } from "@/components/SvgCanvas"
import { useDrawRequest } from "@/hooks/useDrawRequest"

const START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%"></svg>'

export default function DevDraw() {
  const [svg, setSvg] = useState(START)
  const svgRef = useRef(svg)
  svgRef.current = svg
  const [instruction, setInstruction] = useState(
    "draw a single-threaded call stack with a queue beside it, labeled",
  )
  const { draw } = useDrawRequest({
    getSvg: () => svgRef.current,
    setSvg,
    canvasWidth: 800,
  })

  return (
    <div className="flex h-screen flex-col">
      <div className="flex gap-2 p-2">
        <input
          className="flex-1 border p-2"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="border px-4" onClick={() => draw(instruction)}>
          Draw
        </button>
      </div>
      <div className="flex-1 border-t">
        <SvgCanvas svg={svg} />
      </div>
    </div>
  )
}
```

- [x] **Step 2: Verify visually.**

Run `npm run dev`, open `http://localhost:3000/dev/draw`, click **Draw**. Expected: shapes appear progressively (one edit every ~0.5s).

- [x] **Step 3: Commit.**

```bash
git add app/dev/draw/page.tsx
git commit -m "chore: dev page to validate SVG draw animation"
```

---

# Phase 4 — Voice Layer (OpenAI Realtime)

### Task 4.1: VoiceLayer interface + Realtime implementation

**Files:**
- Create: `voice/types.ts`, `voice/realtime.ts`

**Interfaces:**
- Produces:
  - `interface VoiceLayer { speak(text: string): Promise<void>; onUserUtterance(cb: (text: string) => void): void; interrupt(): void; close(): void }`
  - `createRealtimeVoice(): Promise<VoiceLayer>` — mints an ephemeral key from `/api/realtime-token`, opens a WebRTC connection to OpenAI Realtime, plays remote audio, wires input transcription → `onUserUtterance`, and `speak()` drives the model to voice the given text (assistant-item injection + `response.create`).

> NOTE FOR IMPLEMENTER: WebRTC SDP exchange with OpenAI Realtime — verify the exact base URL/model query and event names (`conversation.item.create`, `response.create`, `conversation.item.input_audio_transcription.completed`) against current OpenAI Realtime docs. The shape below is the common WebRTC pattern; treat event names as the thing to confirm.

- [x] **Step 1: Define the interface.**

Create `voice/types.ts`:

```ts
export interface VoiceLayer {
  speak(text: string): Promise<void>
  onUserUtterance(cb: (text: string) => void): void
  interrupt(): void
  close(): void
}
```

- [x] **Step 2: Implement the Realtime voice layer.**

Create `voice/realtime.ts`:

```ts
"use client"

import type { VoiceLayer } from "./types"

export async function createRealtimeVoice(): Promise<VoiceLayer> {
  const tokenRes = await fetch("/api/realtime-token")
  const { client_secret, model } = await tokenRes.json()
  const EPHEMERAL = client_secret.value as string

  const pc = new RTCPeerConnection()

  // remote audio playback
  const audioEl = document.createElement("audio")
  audioEl.autoplay = true
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0]
  }

  // mic
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
  mic.getTracks().forEach((t) => pc.addTrack(t, mic))

  // data channel for events
  const dc = pc.createDataChannel("oai-events")
  let utteranceCb: ((text: string) => void) | null = null

  dc.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data)
    if (
      msg.type ===
      "conversation.item.input_audio_transcription.completed"
    ) {
      const text = msg.transcript?.trim()
      if (text && utteranceCb) utteranceCb(text)
    }
  })

  // SDP offer/answer
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const sdpRes = await fetch(
    `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL}`,
        "Content-Type": "application/sdp",
      },
    },
  )
  await pc.setRemoteDescription({
    type: "answer",
    sdp: await sdpRes.text(),
  })

  const dcOpen = new Promise<void>((resolve) => {
    if (dc.readyState === "open") resolve()
    else dc.addEventListener("open", () => resolve(), { once: true })
  })

  return {
    async speak(text: string) {
      await dcOpen
      // inject the exact words as an assistant message, then request audio
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "text", text }],
          },
        }),
      )
      dc.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio"], instructions: text },
        }),
      )
    },
    onUserUtterance(cb) {
      utteranceCb = cb
    },
    interrupt() {
      dc.send(JSON.stringify({ type: "response.cancel" }))
    },
    close() {
      mic.getTracks().forEach((t) => t.stop())
      pc.close()
    },
  }
}
```

- [x] **Step 3: Commit.**

```bash
git add voice/types.ts voice/realtime.ts
git commit -m "feat: OpenAI Realtime voice layer behind VoiceLayer interface"
```

---

### Task 4.2: Dev page to validate speaking + hearing

**Files:**
- Create: `app/dev/voice/page.tsx`

- [x] **Step 1: Implement.**

Create `app/dev/voice/page.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"
import { createRealtimeVoice } from "@/voice/realtime"
import type { VoiceLayer } from "@/voice/types"

export default function DevVoice() {
  const voiceRef = useRef<VoiceLayer | null>(null)
  const [heard, setHeard] = useState<string[]>([])

  return (
    <div className="p-4 space-y-2">
      <button
        className="border px-4"
        onClick={async () => {
          const v = await createRealtimeVoice()
          v.onUserUtterance((t) => setHeard((h) => [...h, t]))
          voiceRef.current = v
        }}
      >
        Connect
      </button>
      <button
        className="border px-4"
        onClick={() =>
          voiceRef.current?.speak("Hello — can you hear me clearly?")
        }
      >
        Speak
      </button>
      <ul>
        {heard.map((h, i) => (
          <li key={i}>heard: {h}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [x] **Step 2: Verify.**

Open `http://localhost:3000/dev/voice`, click **Connect** (allow mic), click **Speak** — you should hear the sentence. Say something — it should appear under "heard:". Speaking while audio plays should cut it off (barge-in).

- [x] **Step 3: Commit.**

```bash
git add app/dev/voice/page.tsx
git commit -m "chore: dev page to validate Realtime speak + transcription"
```

---

# Phase 5 — Teaching Loop

### Task 5.1: useTeachingSession hook

**Files:**
- Create: `hooks/useTeachingSession.ts`

**Interfaces:**
- Consumes: `NdjsonActionParser` (`lib/ndjson`), `useDrawRequest`, `VoiceLayer`, `Step`, `TeacherAction`.
- Produces: `useTeachingSession({ voice, getSvg, setSvg, canvasWidth })` → `{ start(topic): Promise<void>; steps: Step[]; currentIndex: number; ask(text: string): void; status: "idle"|"planning"|"teaching"|"done" }`.
- Loop: `start` → POST `/api/plan` → set steps → run turn for step 0. A turn: POST `/api/teach`, feed SSE text into `NdjsonActionParser`; for each action — `speak` → `voice.speak`, `draw` → `useDrawRequest.draw`, `done` → when speech + draw settled, advance to next step (or `done`). `ask(text)` interrupts (`voice.interrupt()`) and starts a new turn with the user text appended to `transcript`.

- [x] **Step 1: Implement.**

Create `hooks/useTeachingSession.ts`:

```ts
"use client"

import { useCallback, useRef, useState } from "react"
import { NdjsonActionParser } from "@/lib/ndjson"
import { useDrawRequest } from "@/hooks/useDrawRequest"
import type { VoiceLayer } from "@/voice/types"
import type { Step, TeacherAction } from "@/lib/types"

type Status = "idle" | "planning" | "teaching" | "done"
type Msg = { role: "user" | "assistant"; text: string }

export function useTeachingSession(opts: {
  voice: VoiceLayer | null
  getSvg: () => string
  setSvg: (svg: string) => void
  canvasWidth: number
}) {
  const { voice, getSvg, setSvg, canvasWidth } = opts
  const { draw } = useDrawRequest({ getSvg, setSvg, canvasWidth })

  const [steps, setSteps] = useState<Step[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<Status>("idle")
  const transcriptRef = useRef<Msg[]>([])
  const stepsRef = useRef<Step[]>([])
  const indexRef = useRef(0)

  const runTurn = useCallback(async () => {
    setStatus("teaching")
    const res = await fetch("/api/teach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        steps: stepsRef.current,
        currentIndex: indexRef.current,
        transcript: transcriptRef.current,
      }),
    })
    if (!res.body) return

    const parser = new NdjsonActionParser()
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    let raw = ""
    const pending: Promise<unknown>[] = []

    const handleAction = (a: TeacherAction) => {
      if (a.type === "speak") {
        transcriptRef.current.push({ role: "assistant", text: a.text })
        if (voice) pending.push(voice.speak(a.text))
      } else if (a.type === "draw") {
        pending.push(draw(a.instruction))
      }
    }

    const drainSse = (frame: string) => {
      const ev = frame.split("\n").find((l) => l.startsWith("event: "))?.slice(7)
      const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
      if (ev === "text" && data) {
        const { delta } = JSON.parse(data)
        raw += delta
        for (const a of parser.push(delta)) handleAction(a)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split("\n\n")
      buf = frames.pop() ?? ""
      for (const f of frames) drainSse(f)
    }
    for (const a of parser.flush()) handleAction(a)

    await Promise.all(pending)

    // advance
    if (indexRef.current < stepsRef.current.length - 1) {
      indexRef.current += 1
      setCurrentIndex(indexRef.current)
      await runTurn()
    } else {
      setStatus("done")
    }
  }, [voice, draw])

  const start = useCallback(
    async (topic: string) => {
      setStatus("planning")
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      })
      const { steps: planned } = (await res.json()) as { steps: Step[] }
      stepsRef.current = planned
      indexRef.current = 0
      setSteps(planned)
      setCurrentIndex(0)
      await runTurn()
    },
    [runTurn],
  )

  const ask = useCallback(
    (text: string) => {
      voice?.interrupt()
      transcriptRef.current.push({ role: "user", text })
      void runTurn()
    },
    [voice, runTurn],
  )

  return { start, steps, currentIndex, ask, status }
}
```

- [x] **Step 2: Commit.**

```bash
git add hooks/useTeachingSession.ts
git commit -m "feat: useTeachingSession drives plan -> teach -> speak+draw -> advance"
```

_Validated end-to-end in Phase 6._

---

### Task 5.2: Wire text + voice interruption into the session

**Files:**
- Modify: `hooks/useTeachingSession.ts` (connect `voice.onUserUtterance` → `ask`)

- [x] **Step 1: Register the utterance handler when a voice layer is provided.**

In `hooks/useTeachingSession.ts`, add near the top of the hook body (after `ask` is defined, move `ask` above this or use a ref). Add:

```ts
// after `ask` is defined:
const askRef = useRef(ask)
askRef.current = ask
useEffect(() => {
  voice?.onUserUtterance((t) => askRef.current(t))
}, [voice])
```

Add `useEffect` to the React import: `import { useCallback, useEffect, useRef, useState } from "react"`.

- [x] **Step 2: Commit.**

```bash
git add hooks/useTeachingSession.ts
git commit -m "feat: route voice utterances into the teaching loop as interruptions"
```

---

# Phase 6 — UI

### Task 6.1: Home page (topic input)

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: home page with a topic input; on submit, navigates to `/learn?topic=<encoded>`.

- [x] **Step 1: Implement.**

Replace `app/page.tsx` with:

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const [topic, setTopic] = useState("")
  const router = useRouter()
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">sensei</h1>
      <p className="text-neutral-500">What do you want to learn?</p>
      <form
        className="flex w-full max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (topic.trim())
            router.push(`/learn?topic=${encodeURIComponent(topic.trim())}`)
        }}
      >
        <input
          autoFocus
          className="flex-1 rounded border p-3"
          placeholder="the javascript event loop"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button className="rounded bg-black px-5 text-white">Teach me</button>
      </form>
    </main>
  )
}
```

- [x] **Step 2: Commit.**

```bash
git add app/page.tsx
git commit -m "feat: home page topic input"
```

---

### Task 6.2: Learn page (canvas + progress + text ask + voice)

**Files:**
- Create: `components/ProgressStrip.tsx`, `app/learn/page.tsx`

**Interfaces:**
- Consumes: `SvgCanvas`, `useTeachingSession`, `createRealtimeVoice`, `VoiceLayer`.
- Produces: the learning screen — canvas center, progress strip on top, a text input to ask, and a "Start voice" button that connects Realtime. On mount, reads `?topic=` and starts the session (drawing works even before voice connects; `voice` is `null` until connected).

- [x] **Step 1: ProgressStrip.**

Create `components/ProgressStrip.tsx`:

```tsx
export function ProgressStrip({
  current,
  total,
  label,
}: {
  current: number
  total: number
  label?: string
}) {
  if (total === 0) return null
  return (
    <div className="flex items-center gap-2 p-2 text-sm text-neutral-600">
      <span className="font-medium">
        Step {current + 1} of {total}
      </span>
      {label && <span className="text-neutral-400">— {label}</span>}
    </div>
  )
}
```

- [x] **Step 2: Learn page.**

Create `app/learn/page.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { SvgCanvas } from "@/components/SvgCanvas"
import { ProgressStrip } from "@/components/ProgressStrip"
import { useTeachingSession } from "@/hooks/useTeachingSession"
import { createRealtimeVoice } from "@/voice/realtime"
import type { VoiceLayer } from "@/voice/types"

const START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%"></svg>'

export default function Learn() {
  const params = useSearchParams()
  const topic = params.get("topic") ?? ""
  const [svg, setSvg] = useState(START)
  const svgRef = useRef(svg)
  svgRef.current = svg
  const [voice, setVoice] = useState<VoiceLayer | null>(null)
  const [ask, setAsk] = useState("")
  const startedRef = useRef(false)

  const session = useTeachingSession({
    voice,
    getSvg: () => svgRef.current,
    setSvg,
    canvasWidth: 800,
  })

  useEffect(() => {
    if (topic && !startedRef.current) {
      startedRef.current = true
      void session.start(topic)
    }
  }, [topic, session])

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center justify-between border-b">
        <ProgressStrip
          current={session.currentIndex}
          total={session.steps.length}
          label={session.steps[session.currentIndex]?.label}
        />
        {!voice && (
          <button
            className="m-2 rounded border px-3 py-1 text-sm"
            onClick={async () => setVoice(await createRealtimeVoice())}
          >
            Start voice
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <SvgCanvas svg={svg} />
      </div>
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ask.trim()) {
            session.ask(ask.trim())
            setAsk("")
          }
        }}
      >
        <input
          className="flex-1 rounded border p-2"
          placeholder="Ask a question…"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <button className="rounded bg-black px-4 text-white">Ask</button>
      </form>
    </div>
  )
}
```

- [x] **Step 3: Verify end-to-end.**

Run `npm run dev`. From `/`, type a topic → `/learn` starts; the canvas draws and (after clicking **Start voice**) the teacher speaks; typing a question interrupts and redirects the turn.

- [x] **Step 4: Commit.**

```bash
git add components/ProgressStrip.tsx app/learn/page.tsx
git commit -m "feat: learn page with canvas, progress strip, voice, and text ask"
```

---

## Final: full test run + push

- [x] Run `npm run test` — all Phase 1 unit suites pass.
- [x] Run `npm run build` — the app builds.
- [x] Push: `git push`.

---

## Notes for the implementer (verify against live docs)

- **OpenAI Realtime** (Tasks 2.5, 4.1): confirm the ephemeral-session endpoint, the WebRTC SDP endpoint/model query, and the event names (`conversation.item.create`, `response.create`, `response.cancel`, `input_audio_transcription.completed`) against the current OpenAI Realtime documentation. If speaking Claude's exact text through Realtime proves unreliable, fall back to OpenAI streaming TTS for output while keeping Realtime for mic + VAD + transcription (the `VoiceLayer` interface makes this a localized swap).
- **Claude structured outputs + adaptive thinking** (Task 2.2): if `output_config.format` with the plan schema ever conflicts with thinking, drop `thinking` on `/api/plan` (it is a simple task) — the teach/draw routes do not use structured outputs.
- Keep `snapshotPng` optional in the draw loop for v1; add canvas→PNG snapshotting later if the SVG agent needs the visual (the route already accepts it).
