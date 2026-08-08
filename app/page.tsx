import Link from "next/link"
import { count, desc, eq } from "drizzle-orm"
import { auth, signOut } from "@/lib/auth"
import { db, lessonPages, lessons } from "@/lib/db"
import { TopicForm } from "@/components/TopicForm"

// Never cached: the list below changes every time a lesson is taught.
export const dynamic = "force-dynamic"

// A server component now, so it can say who you are. The topic box moved to
// components/TopicForm.tsx unchanged — it needs state and a router, this needs
// the session, and those cannot be the same component.
export default async function Home() {
  const session = await auth()
  const user = session?.user

  // Read here rather than through /api/lessons: this page is already a server
  // component with a session in hand, and a fetch to our own route would be a
  // round trip to ask ourselves something we can just look up.
  const saved =
    user?.status === "approved"
      ? await db
          .select({
            id: lessons.id,
            topic: lessons.topic,
            pages: count(lessonPages.id),
          })
          .from(lessons)
          .leftJoin(lessonPages, eq(lessonPages.lessonId, lessons.id))
          .where(eq(lessons.userId, user.id))
          .groupBy(lessons.id, lessons.topic, lessons.createdAt)
          .orderBy(desc(lessons.createdAt))
          .limit(8)
      : []

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

      {saved.length > 0 && (
        <section className="mt-6 w-full max-w-lg">
          <h2 className="mb-2 text-sm font-medium text-neutral-500">
            Taught before — replays without calling a model
          </h2>
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
            {saved.map((lesson) => (
              <li key={lesson.id}>
                <Link
                  href={`/learn?lesson=${lesson.id}`}
                  className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  <span className="truncate">{lesson.topic}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {lesson.pages} {lesson.pages === 1 ? "page" : "pages"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {/* Worth saying plainly, because it is the reason this list exists:
              a replay costs nothing and cannot fail on a slow connection. */}
          <p className="mt-2 text-xs text-neutral-500">
            Narration is re-synthesised; everything else is read back from the database.
          </p>
        </section>
      )}
    </main>
  )
}
