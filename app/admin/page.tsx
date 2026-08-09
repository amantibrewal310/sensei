import Link from "next/link"
import { redirect } from "next/navigation"
import { asc, desc, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, users } from "@/lib/db"
import { decide } from "./actions"
import { Spend } from "./spend"

export const metadata = { title: "Admin — sensei" }

// Never cached. The whole page is "who is waiting right now", and a stale
// answer to that is worse than a slow one.
export const dynamic = "force-dynamic"

const BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-neutral-200 text-neutral-600",
}

function when(date: Date | null) {
  if (!date) return "—"
  return date.toISOString().slice(0, 16).replace("T", " ")
}

export default async function Admin() {
  const me = (await auth())?.user
  if (!me) redirect("/login?next=/admin")
  // Not `notFound()`: a signed-in learner who guesses this URL is not owed a
  // page that hints one exists. They get sent where they were going to be sent
  // anyway.
  if (me.role !== "admin" || me.status !== "approved") redirect("/")

  const everyone = await db
    .select()
    .from(users)
    // Pending first, because this page exists to be acted on and everything
    // else on it is history. Within a group, newest first.
    .orderBy(
      asc(sql`case when ${users.status} = 'pending' then 0 else 1 end`),
      desc(users.createdAt),
    )

  const waiting = everyone.filter((u) => u.status === "pending").length

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <Link href="/" className="text-sm text-neutral-500 underline">
          Back to sensei
        </Link>
      </div>

      <p className="mb-6 text-sm text-neutral-600">
        {waiting === 0
          ? "Nobody is waiting."
          : `${waiting} ${waiting === 1 ? "person is" : "people are"} waiting.`}{" "}
        An approved account can start lessons, which spends the API budget — so this is
        the list that decides what this project costs.
      </p>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-neutral-500">
          <tr>
            <th className="py-2 font-medium">Who</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">Signed up</th>
            <th className="py-2 font-medium">Decided</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {everyone.map((u) => (
            <tr key={u.id} className="border-b border-neutral-100 align-middle">
              <td className="py-3">
                <div>{u.name ?? "—"}</div>
                <div className="text-neutral-500">{u.email}</div>
              </td>
              <td className="py-3">
                <span className={`rounded px-2 py-0.5 text-xs ${BADGE[u.status]}`}>
                  {u.status}
                </span>
                {u.role === "admin" && (
                  <span className="ml-1 rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                    admin
                  </span>
                )}
              </td>
              <td className="py-3 text-neutral-500">{when(u.createdAt)}</td>
              <td className="py-3 text-neutral-500">{when(u.approvedAt)}</td>
              <td className="py-3 text-right">
                {/* No buttons on your own row. `decide` refuses it too — this
                    only saves you the click, it is not what stops you locking
                    yourself out. */}
                {u.id === me.id ? (
                  <span className="text-xs text-neutral-400">you</span>
                ) : (
                  <div className="flex justify-end gap-2">
                    {u.status !== "approved" && (
                      <form
                        action={async () => {
                          "use server"
                          await decide({ userId: u.id, status: "approved" })
                        }}
                      >
                        <button className="rounded bg-neutral-900 px-3 py-1 text-xs text-white">
                          Approve
                        </button>
                      </form>
                    )}
                    {u.status !== "rejected" && (
                      <form
                        action={async () => {
                          "use server"
                          await decide({ userId: u.id, status: "rejected" })
                        }}
                      >
                        <button className="rounded border border-neutral-300 px-3 py-1 text-xs">
                          Reject
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Said here because the page cannot tell you, and the failure is silent:
          a learner is not emailed when they are approved. */}
      <p className="mt-6 text-xs text-neutral-500">
        Approving someone takes effect on their next page load — sessions are read from
        the database, not from a token they would have to sign out to refresh. They are
        not emailed about it.
      </p>

      <Spend />
    </main>
  )
}
