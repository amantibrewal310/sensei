// One line per server start, stamped with the deploy it is running.
//
// The structured log lines ({"at":"usage"}, {"at":"limit"}) are only readable
// as a history if you can tell which build wrote them — "did cost drop because
// of the effort change or before it?" is unanswerable in a stream with no
// version marks. On Vercel this fires on every cold start, which is exactly
// the granularity a drain needs: every run of log lines begins by saying whose
// they are. /api/health reports the same sha for the outside-in view.
export function register(): void {
  console.log(
    JSON.stringify({ at: "boot", sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }),
  )
}
