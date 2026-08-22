import { redirect } from "next/navigation"
import { auth, signIn } from "@/lib/auth"
import { safeNext } from "@/lib/redirect"
import { AlertIcon, GoogleIcon } from "@/components/Icons"
import { LogoMark, Wordmark } from "@/components/Logo"
import { ThemeToggle } from "@/components/ThemeToggle"

export const metadata = { title: "Sign in — sensei" }

/** Auth.js reports failures as a code in the URL; only some of them mean something here. */
const REASON: Record<string, string> = {
  OAuthAccountNotLinked: "That email is already registered by another sign-in method.",
  AccessDenied: "Google did not complete the sign-in.",
  Configuration: "Sign-in is misconfigured on the server. The logs will say which part.",
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams
  const to = safeNext(next)

  // Nothing to do here if they are already signed in — and landing on a sign-in
  // page when you are signed in reads as "it didn't work".
  const session = await auth()
  if (session?.user) redirect(session.user.status === "approved" ? to : "/pending")

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="fixed top-3 right-3 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <LogoMark className="h-11 w-11" />
          <h1 className="mt-4 font-serif text-2xl font-medium tracking-tight">
            Sign in to <Wordmark className="text-2xl" />
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted text-pretty">
            An AI tutor that draws while it talks. Sign in to ask for a lesson.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{REASON[error] ?? "Sign-in failed. Try again."}</span>
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            "use server"
            await signIn("google", { redirectTo: to })
          }}
        >
          <button className="btn btn-secondary btn-lg w-full">
            <GoogleIcon />
            Continue with Google
          </button>
        </form>

        {/* Said before they sign in rather than after, because being told you are
            in a queue is only annoying when it is a surprise. */}
        <p className="mt-6 border-t border-line pt-5 text-center text-[13px] leading-relaxed text-faint text-pretty">
          New accounts need approval before their first lesson — this app runs on a
          metered API budget, so access is granted by hand.
        </p>
      </div>
    </main>
  )
}
