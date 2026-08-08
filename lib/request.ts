import { NextResponse } from "next/server"
import { z } from "zod"

// Reading a request body, in one place.
//
// Every route used to cast — `(await req.json()) as Body` — and then hand-check
// the two or three fields it happened to remember. That is how `existing` on
// /api/draw-panel came to be passed straight to `describeBlocks` and into the
// prompt on the strength of `Array.isArray()` alone, with nothing anywhere
// checking that its contents were Blocks. zod was already a dependency; it was
// just only ever pointed at model output, never at input.

/** A 400 that names the field, rather than only admitting one was wrong. */
function badRequest(error: z.ZodError): NextResponse {
  const issue = error.issues[0]
  const where = issue?.path.join(".")
  const message = issue?.message ?? "invalid request"
  return NextResponse.json(
    { error: where ? `${where}: ${message}` : message },
    { status: 400 },
  )
}

type Read<S extends z.ZodType> =
  { ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }

/**
 * Parses a JSON request body against `schema`.
 *
 * Returns a discriminated union rather than throwing, so a route reads as
 * `if (!body.ok) return body.response` and TypeScript narrows `body.data` to
 * the parsed shape on the line after — no casts, and no way to forget the
 * failure branch.
 */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<Read<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "expected a JSON body" }, { status: 400 }),
    }
  }

  const parsed = schema.safeParse(raw)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, response: badRequest(parsed.error) }
}

/**
 * `JSON.parse` that answers `null` instead of throwing.
 *
 * For model output specifically: structured outputs make malformed JSON
 * unlikely, not impossible, and a 502 is the honest answer when it happens.
 */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
