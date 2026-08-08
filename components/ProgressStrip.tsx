import type { Page } from "@/lib/lesson"

export function ProgressStrip({
  page,
  index,
  total,
}: {
  page?: Page
  index: number
  total: number
}) {
  if (!page) return null
  return (
    <div className="flex min-w-0 items-baseline gap-3 px-5 py-3">
      <h1 className="truncate text-sm font-medium text-neutral-900">{page.title}</h1>
      <span className="shrink-0 text-xs tabular-nums text-neutral-400">
        {index + 1} / {total}
      </span>
    </div>
  )
}
