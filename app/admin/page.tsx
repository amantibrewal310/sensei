import { redirect } from "next/navigation"
import { asc, desc, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, users } from "@/lib/db"
import { AppHeader } from "@/components/AppHeader"
import { CheckIcon, CloseIcon } from "@/components/Icons"
import { decide } from "./actions"
import { Spend } from "./spend"

export const metadata = { title: "Admin — sensei" }

// Never cached. The whole page is "who is waiting right now", and a stale
// answer to that is worse than a slow one.
export const dynamic = "force-dynamic"

const BADGE: Record<string, string> = {
  pending: "badge badge-warn",
  approved: "badge badge-accent",
  rejected: "badge badge-neutral",
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
  const approved = everyone.filter((u) => u.status === "approved").length

  return (
    <>
      <AppHeader user={me} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="font-serif text-2xl font-medium tracking-tight">Approvals</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted text-pretty">
          An approved account can start lessons, which spends the API budget — so this is
          the list that decides what this project costs.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Waiting" value={waiting} warn={waiting > 0} />
          <Stat label="Approved" value={approved} />
          <Stat label="Accounts" value={everyone.length} />
        </div>

        {/* A list of rows rather than a table: five columns of dates and
            buttons do not survive a laptop being half-screened, and the only
            column anyone scans is the first. */}
        <ul className="card mt-4 divide-y divide-line">
          {everyone.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 font-medium text-muted">
                {(u.name ?? u.email ?? "?").trim().charAt(0).toUpperCase()}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{u.name ?? "—"}</span>
                  <span className={BADGE[u.status]}>{u.status}</span>
                  {u.role === "admin" && (
                    <span className="badge badge-accent">admin</span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-faint">
                  {u.email}
                </span>
              </span>

              <span className="hidden text-right font-mono text-[11px] leading-relaxed text-faint sm:block">
                <span className="block">joined {when(u.createdAt)}</span>
                <span className="block">decided {when(u.approvedAt)}</span>
              </span>

              {/* No buttons on your own row. `decide` refuses it too — this
                  only saves you the click, it is not what stops you locking
                  yourself out. */}
              {u.id === me.id ? (
                <span className="badge badge-neutral">you</span>
              ) : (
                <span className="flex gap-2">
                  {u.status !== "approved" && (
                    <form
                      action={async () => {
                        "use server"
                        await decide({ userId: u.id, status: "approved" })
                      }}
                    >
                      <button className="btn btn-primary btn-sm">
                        <CheckIcon />
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
                      <button className="btn btn-secondary btn-sm">
                        <CloseIcon />
                        Reject
                      </button>
                    </form>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Said here because the page cannot tell you, and the failure is silent:
            a learner is not emailed when they are approved. */}
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Approving someone takes effect on their next page load — sessions are read from
          the database, not from a token they would have to sign out to refresh. They are
          not emailed about it.
        </p>

        <Spend />
      </main>
    </>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 font-serif text-2xl tabular-nums ${warn ? "text-warn" : ""}`}>
        {value}
      </div>
    </div>
  )
}
