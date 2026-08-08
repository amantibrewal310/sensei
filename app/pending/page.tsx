import { redirect } from "next/navigation"
import { auth, signOut } from "@/lib/auth"

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
    <main className="flex h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">
        {rejected ? "Not approved" : "Waiting for approval"}
      </h1>

      <p className="max-w-md text-neutral-600">
        {rejected ? (
          <>This account was not approved for sensei.</>
        ) : (
          <>
            Your request is with the administrator. You will get an email when it is
            approved — then reload this page and the lesson is yours.
          </>
        )}
      </p>

      <p className="text-sm text-neutral-500">Signed in as {session.user.email}</p>

      <form
        action={async () => {
          "use server"
          await signOut({ redirectTo: "/login" })
        }}
      >
        <button className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50">
          Sign out
        </button>
      </form>
    </main>
  )
}
