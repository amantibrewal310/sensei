import Link from "next/link"
import { BoardIcon } from "@/components/Icons"

export const metadata = { title: "Not found — sensei" }

// Next's own 404 is unstyled black-on-white and ignores `color-scheme`, so on a
// dark window it arrives as a white flash that reads like the app crashed.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-2 text-faint">
        <BoardIcon className="h-5 w-5" />
      </span>

      <h1 className="mt-5 font-serif text-2xl font-medium tracking-tight">
        Nothing is taught here.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted text-pretty">
        This address has no page behind it. Lessons start from a topic, so the way back in
        is to name one.
      </p>

      <Link href="/" className="btn btn-primary mt-7">
        Pick a topic
      </Link>
    </main>
  )
}
