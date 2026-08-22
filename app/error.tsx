"use client"

import Link from "next/link"
import { useEffect } from "react"
import { reportClientError } from "@/lib/report"
import { AlertIcon } from "@/components/Icons"

// The last line of defence, and the reason it exists is `components/Board.tsx`:
// it drives tldraw's store imperatively — creating pages, deriving shape ids,
// updating records mid-reveal — so a shape id colliding or a page being opened
// twice throws during render rather than resolving to a rejected promise
// somebody catches. With no boundary that takes the whole lesson down to a
// blank page in production, losing every panel already drawn and giving the
// learner nothing to act on.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Deliberate: a boundary that swallows the throw is how a rendering bug
    // survives to production unnoticed. `digest` is the only handle on the
    // server-side stack once minified.
    console.error("[sensei] unhandled render error", error.digest, error)
    // And a copy for the server log, because the console above is in a browser
    // nobody operates — this is the line a person can actually be paged on.
    reportClientError("render", error, error.digest)
  }, [error])

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-danger-line bg-danger-soft text-danger">
        <AlertIcon className="h-5 w-5" />
      </span>

      <h1 className="mt-5 font-serif text-2xl font-medium tracking-tight">
        The lesson hit a snag.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted text-pretty">
        Something broke while drawing. The board can&rsquo;t be recovered, but starting
        the lesson again usually works.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Pick another topic
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-[11px] text-faint">
          <span className="eyebrow">digest</span> {error.digest}
        </p>
      )}
    </main>
  )
}
