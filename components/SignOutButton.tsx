import { signOut } from "@/lib/auth"

/** The sign-out form every signed-in page renders; the server action lives here once. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server"
        await signOut({ redirectTo: "/login" })
      }}
    >
      <button className={className ?? "btn btn-ghost btn-sm"}>Sign out</button>
    </form>
  )
}
