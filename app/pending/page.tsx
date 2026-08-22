import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { PollForApproval } from "@/components/PollForApproval"
import { SignOutButton } from "@/components/SignOutButton"
import { ThemeToggle } from "@/components/ThemeToggle"
import { CheckIcon, ClockIcon } from "@/components/Icons"
import { LogoMark } from "@/components/Logo"

export const metadata = { title: "Waiting for approval — sensei" }

export default async function Pending() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  // Approved while they sat here. Database sessions are what make this
  // possible at all: the status is read fresh, not carried in a token they
  // would have to sign out to refresh.
  if (session.user.status === "approved") redirect("/")

  const rejected = session.user.status === "rejected"

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="fixed top-3 right-3 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md text-center">
        <LogoMark className="mx-auto h-10 w-10" />

        <h1 className="mt-5 font-serif text-2xl font-medium tracking-tight">
          {rejected ? "Not approved" : "Waiting for approval"}
        </h1>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted text-pretty">
          {rejected ? (
            <>This account was not approved for sensei.</>
          ) : (
            <>
              Your request is with the administrator. Leave this page open — it checks for
              itself, and the moment you are approved the lesson is yours.
            </>
          )}
        </p>

        {/* Three states of one process, so the wait has a shape. The page is
            otherwise a sentence and a spinner, which reads as stalled. */}
        {!rejected && (
          <ol className="card mx-auto mt-8 max-w-sm divide-y divide-line text-left">
            <Step done label="Signed in with Google" note={session.user.email ?? ""} />
            <Step
              current
              label="An administrator reviews the account"
              note="Checked automatically every 15 seconds"
            />
            <Step label="Lessons unlock" note="Takes effect on the next page load" />
          </ol>
        )}

        {/* Only while there is something to wait for. A rejected account polling
            forever is a page pretending a decision has not been made. */}
        {!rejected && <PollForApproval />}

        <div className="mt-8 flex items-center justify-center gap-3 text-sm text-faint">
          {rejected && <span className="truncate">{session.user.email}</span>}
          <SignOutButton className="btn btn-secondary btn-sm" />
        </div>
      </div>
    </main>
  )
}

function Step({
  label,
  note,
  done,
  current,
}: {
  label: string
  note: string
  done?: boolean
  current?: boolean
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
          done
            ? "border-accent bg-accent text-on-accent"
            : current
              ? "border-warn text-warn"
              : "border-line-strong text-faint"
        }`}
      >
        {done ? (
          <CheckIcon className="h-3 w-3" />
        ) : current ? (
          <ClockIcon className="h-3 w-3" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm ${current ? "font-medium" : ""}`}>{label}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">{note}</span>
      </span>
    </li>
  )
}
