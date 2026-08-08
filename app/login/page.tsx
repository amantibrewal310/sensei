import { redirect } from "next/navigation"
import { auth, signIn } from "@/lib/auth"
import { safeNext } from "@/lib/redirect"

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
    <main className="flex h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">sensei</h1>
        <p className="mt-2 max-w-sm text-neutral-500">
          An AI tutor that draws while it talks. Sign in to ask for a lesson.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="max-w-sm rounded border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800"
        >
          {REASON[error] ?? "Sign-in failed. Try again."}
        </p>
      )}

      <form
        action={async () => {
          "use server"
          await signIn("google", { redirectTo: to })
        }}
      >
        <button className="rounded border border-neutral-300 bg-white px-5 py-3 font-medium shadow-sm hover:bg-neutral-50">
          Continue with Google
        </button>
      </form>

      {/* Said before they sign in rather than after, because being told you are
          in a queue is only annoying when it is a surprise. */}
      <p className="max-w-sm text-center text-sm text-neutral-500">
        New accounts need approval before their first lesson — this app runs on a metered
        API budget, so access is granted by hand.
      </p>
    </main>
  )
}
