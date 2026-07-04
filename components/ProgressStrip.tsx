export function ProgressStrip({
  current,
  total,
  label,
}: {
  current: number
  total: number
  label?: string
}) {
  if (total === 0) return null
  return (
    <div className="flex items-center gap-2 p-2 text-sm text-neutral-600">
      <span className="font-medium">
        Step {current + 1} of {total}
      </span>
      {label && <span className="text-neutral-400">— {label}</span>}
    </div>
  )
}
