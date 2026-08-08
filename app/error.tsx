"use client"

import Link from "next/link"
import { useEffect } from "react"

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
  }, [error])

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">The lesson hit a snag.</h1>
      <p className="max-w-md text-neutral-500">
        Something broke while drawing. The board can&rsquo;t be recovered, but starting
        the lesson again usually works.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-neutral-400">{error.digest}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
        >
          Try again
        </button>
        <Link href="/" className="rounded border border-neutral-300 px-4 py-2 text-sm">
          Pick another topic
        </Link>
      </div>
    </main>
  )
}
