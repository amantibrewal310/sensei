"use client"

import { useSyncExternalStore } from "react"
import { ContrastIcon, MoonIcon, SunIcon } from "@/components/Icons"

type Theme = "light" | "dark"

// The theme is not React state — it is an attribute on <html> that a script in
// the document head already set before React existed, plus an OS preference
// that can change while the page is open. So it is read as an external store
// rather than copied into state, which is also what keeps a second toggle in
// another header from disagreeing with this one.
const listeners = new Set<() => void>()

// One MediaQueryList for the module, created on first use rather than at import
// so this file stays importable on the server. `read` is the getSnapshot React
// calls on every render, and on /learn that is once per 90ms code tick — it has
// no business parsing a media query each time.
let darkQuery: MediaQueryList | null = null
function dark() {
  darkQuery ??= window.matchMedia("(prefers-color-scheme: dark)")
  return darkQuery
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  const media = dark()
  media.addEventListener("change", onChange)
  return () => {
    listeners.delete(onChange)
    media.removeEventListener("change", onChange)
  }
}

function read(): Theme {
  const chosen = document.documentElement.dataset.theme
  if (chosen === "dark" || chosen === "light") return chosen
  return dark().matches ? "dark" : "light"
}

/**
 * Two states, not three. A "system" option is a setting people have to reason
 * about; the default already follows the system, and touching this is the act
 * of overriding it — so the control just says which one you are in.
 *
 * On the server the answer is unknowable, so it renders a neutral glyph rather
 * than guessing wrong and flipping under the cursor a frame later.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => null)

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem("sensei-theme", next)
    } catch {
      // Safari in private mode throws on write. The theme still applies for
      // this page; it just will not be remembered, which is not worth failing.
    }
    listeners.forEach((notify) => notify())
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-sm btn-icon"
      aria-label={
        theme ? `Switch to ${theme === "dark" ? "light" : "dark"} theme` : "Switch theme"
      }
    >
      {theme === null ? (
        <ContrastIcon className="h-[1.05rem] w-[1.05rem]" />
      ) : theme === "dark" ? (
        <SunIcon className="h-[1.05rem] w-[1.05rem]" />
      ) : (
        <MoonIcon className="h-[1.05rem] w-[1.05rem]" />
      )}
    </button>
  )
}
