import Link from "next/link"

// The mark is the lesson itself: three boxes joined by arrows, drawn in one
// stroke, with the pen just lifted off the end — the only blue in it. It is
// the step track, put to work as a logo.
//
// Two drawings of it, both from the identity sheet in Paper. The hand-drawn
// one's wobble and arrowheads need room, so header sizes get the hinted one:
// straight lines on a 16px grid, which is what the favicon is too.
const DRAWN =
  "M40.6 31.2Q41.4 22.6 40.4 14.6Q23.4 12.9 6.2 15.8Q4.6 31.8 5.6 48.4Q23 50.2 40.8 47.8Q41.8 39.6 40.6 31.2Q62 28.8 84.2 31L76.2 24.6L84.2 31L76.8 37.6L84.2 31Q83.2 22.4 84.8 13.6Q101.6 12.4 118.6 15.4Q119.6 23.8 118.2 32.2Q117 40.6 117.6 48.9Q100.4 50.4 83.6 47.8Q84.8 39.4 84.2 31Q83.2 22.4 84.8 13.6Q101.6 12.4 118.6 15.4Q119.6 23.8 118.2 32.2Q140 34.4 162.2 31.4L154.4 25.2L162.2 31.4L154 37.6L162.2 31.4Q162.9 22.8 161.6 14.8Q179 16.4 196.4 13.6Q197.6 22 196.6 31Q195.6 39.8 196.8 48.2Q179.6 46.6 162.4 48.6Q161.4 40.2 162.2 31.4Q162.9 22.8 161.6 14.8Q179 16.4 196.4 13.6Q197.6 22 196.6 31Q218 33.6 235.8 28.4"
const HINTED =
  "M0.7 6.6H3.5V9.4H0.7Z M3.5 8H5.3 M5.3 6.6H8.1V9.4H5.3Z M8.1 8H9.9 M9.9 6.6H12.7V9.4H9.9Z"

/** Height comes from `className`; the width follows the mark's own aspect. */
export function LogoMark({
  className,
  drawn = false,
}: {
  className?: string
  drawn?: boolean
}) {
  return drawn ? (
    <svg
      viewBox="0 8 250 48"
      className={`w-auto shrink-0 text-text ${className ?? "h-10"}`}
      aria-hidden="true"
    >
      <path
        d={DRAWN}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="240.2" cy="27.2" r="5.6" fill="var(--accent)" />
    </svg>
  ) : (
    <svg
      viewBox="0.1 6 15.8 4"
      className={`w-auto shrink-0 text-text ${className ?? "h-3"}`}
      aria-hidden="true"
    >
      <path d={HINTED} fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="14.78" cy="8" r="1.07" fill="var(--accent)" />
    </svg>
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
      <LogoMark className="h-3.5" />
      <Wordmark />
      <span className="sr-only">— home</span>
    </Link>
  )
}
