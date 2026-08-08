import Link from "next/link"
import { auth, signOut } from "@/lib/auth"
import { TopicForm } from "@/components/TopicForm"

// A server component now, so it can say who you are. The topic box moved to
// components/TopicForm.tsx unchanged — it needs state and a router, this needs
// the session, and those cannot be the same component.
export default async function Home() {
  const session = await auth()
  const user = session?.user

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-8">
      <header className="absolute top-0 right-0 flex items-center gap-3 p-4 text-sm">
        {user ? (
          <>
            {user.role === "admin" && (
              <Link href="/admin" className="text-neutral-600 underline">
                Approvals
              </Link>
            )}
            <span className="text-neutral-500">{user.email}</span>
            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/login" })
              }}
            >
              <button className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/login"
            className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50"
          >
            Sign in
          </Link>
        )}
      </header>

      <h1 className="text-3xl font-semibold">sensei</h1>
      <p className="text-neutral-500">What do you want to learn?</p>
      <TopicForm />

      {user && user.status !== "approved" && (
        <p className="text-sm text-amber-700">
          Your account is still{" "}
          <Link href="/pending" className="underline">
            waiting for approval
          </Link>
          .
        </p>
      )}
    </main>
  )
}
