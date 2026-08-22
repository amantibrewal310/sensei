import Link from "next/link"
import type { Session } from "next-auth"
import { Logo } from "@/components/Logo"
import { ShieldIcon } from "@/components/Icons"
import { SignOutButton } from "@/components/SignOutButton"
import { ThemeToggle } from "@/components/ThemeToggle"

// One header for every page that is not the lesson. /learn has its own, because
// a lesson bar carries the lesson's state and this one carries the account's,
// and folding them together made both worse.
export function AppHeader({ user }: { user?: Session["user"] }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-glass backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />

        <div className="flex items-center gap-1.5">
          {user ? (
            <>
              {user.role === "admin" && (
                <Link href="/admin" className="btn btn-ghost btn-sm">
                  <ShieldIcon />
                  <span className="hidden sm:inline">Approvals</span>
                </Link>
              )}
              {/* Hidden on phones rather than truncated: an email cut to
                  "aman…" identifies nobody, and the sign-out button beside it
                  already says an account is signed in. */}
              <span className="hidden max-w-[16rem] truncate px-2 text-sm text-muted md:inline">
                {user.email}
              </span>
              <ThemeToggle />
              <SignOutButton />
            </>
          ) : (
            <>
              <ThemeToggle />
              <Link href="/login" className="btn btn-secondary btn-sm">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
