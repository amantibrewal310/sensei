import Link from "next/link"
import { auth } from "@/lib/auth"
import { listLessons } from "@/lib/lessons-db"
import { AppHeader } from "@/components/AppHeader"
import { TopicForm } from "@/components/TopicForm"
import {
  BoardIcon,
  ClockIcon,
  CodeIcon,
  ReplayIcon,
  SoundOnIcon,
} from "@/components/Icons"

// Never cached: the list below changes every time a lesson is taught.
export const dynamic = "force-dynamic"

/** Rendered on the server and never re-rendered, so a coarse answer is the honest one. */
function ago(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days < 1) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months === 1 ? "last month" : `${months} months ago`
}

const HOW_IT_WORKS = [
  {
    icon: BoardIcon,
    title: "Drawn, not slid",
    body: "Each page gets an empty whiteboard, filled in one shape at a time as it is explained.",
  },
  {
    icon: SoundOnIcon,
    title: "Spoken in step",
    body: "A sentence is narrated while the thing it describes is being drawn beside it.",
  },
  {
    icon: CodeIcon,
    title: "Code where it earns it",
    body: "Real monospace in a pane of its own — selectable, copyable, off the canvas.",
  },
]

// A server component, so it can say who you are. The topic box is its own
// client component: it needs state and a router, this needs the session, and
// those cannot be the same component.
export default async function Home() {
  const session = await auth()
  const user = session?.user

  // Read here rather than through /api/lessons: this page is already a server
  // component with a session in hand, and a fetch to our own route would be a
  // round trip to ask ourselves something we can just look up.
  const saved = user?.status === "approved" ? await listLessons(user.id, 8) : []

  return (
    <>
      <AppHeader user={user} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 sm:px-6">
        <section className="pt-16 pb-2 text-center sm:pt-24">
          <p className="eyebrow">An AI tutor that draws while it talks</p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl">
            What do you want to learn?
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted text-pretty">
            Name a topic. sensei plans it into pages, then teaches them one at a time —
            speaking, sketching the diagram beside itself, and writing the code where code
            is the honest answer.
          </p>
        </section>

        <div className="mt-8">
          <TopicForm />
        </div>

        {user && user.status !== "approved" && (
          <p className="mx-auto mt-6 flex max-w-lg items-center justify-center gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
            <ClockIcon className="h-4 w-4 shrink-0" />
            <span>
              This account is still{" "}
              <Link href="/pending" className="underline underline-offset-2">
                waiting for approval
              </Link>
              .
            </span>
          </p>
        )}

        {saved.length > 0 && (
          <section className="mt-16">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="eyebrow">Taught before</h2>
              <p className="text-xs text-faint">Replays without calling a model</p>
            </div>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {saved.map((lesson) => (
                <li key={lesson.id}>
                  <Link
                    href={`/learn?lesson=${lesson.id}`}
                    className="card group flex h-full items-start gap-3 p-4 transition-colors hover:border-line-strong hover:bg-surface-hover"
                  >
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent transition-colors">
                      <ReplayIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[15px] font-medium">
                        {lesson.topic}
                      </span>
                      <span className="mt-0.5 block text-xs text-faint">
                        {lesson.pages} {lesson.pages === 1 ? "page" : "pages"} ·{" "}
                        {ago(lesson.createdAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Worth saying plainly, because it is the reason this list exists:
                a replay costs nothing and cannot fail on a slow connection. */}
            <p className="mt-3 text-xs text-faint">
              Narration is re-synthesised; everything else is read back from the database.
            </p>
          </section>
        )}

        <section className="mt-20 grid gap-6 border-t border-line pt-10 sm:grid-cols-3">
          {HOW_IT_WORKS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-5 w-5 text-accent" />
              <h3 className="mt-2.5 text-sm font-medium">{title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  )
}
