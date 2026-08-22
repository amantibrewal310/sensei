import Link from "next/link"

// The mark is the lesson itself: one stroke drawn across a board, with the
// nib still on it. No wordmark inside the glyph, so it survives at 16px in a
// browser tab.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[0.55rem] bg-solid text-on-solid ${
        className ?? "h-7 w-7"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" aria-hidden="true">
        <path
          d="M5 15.5c3.4-6.2 6.3-8.4 8.7-6.6 1.9 1.4.8 4.2-1.4 4.2-2.7 0-3.2-3.6.4-3.6 2.2 0 3.6 1.3 5.3 3.9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="18.6" cy="13.7" r="1.9" fill="currentColor" />
      </svg>
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={`font-serif font-medium tracking-tight ${className ?? "text-[17px]"}`}
    >
      sensei
    </span>
  )
}

/** Home link in every header. One place, so the mark and the word never drift. */
export function Logo() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 rounded-lg py-1 text-text transition-opacity hover:opacity-70"
    >
      <LogoMark />
      <Wordmark />
      <span className="sr-only">— home</span>
    </Link>
  )
}
