import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// React only allows `act` when it is told it is under test, and Testing Library
// only auto-cleans when it can see a global `afterEach` — neither is true with
// vitest's `globals` left off, which is why both are wired up by hand here.
// Without the cleanup, a hook from one test stays mounted and keeps running its
// teaching loop through the next one.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(cleanup)
