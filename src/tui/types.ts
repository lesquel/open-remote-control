// types.ts — Shared TUI types.
//
// Mirrors the shape in src/core/state/store.ts. Kept separate so the TUI
// module can import types without pulling in Node's `fs` or `os` modules.

export interface PilotState {
  token: string
  port: number
  host: string
  startedAt: number
  /** PID of the primary pilot server process. Present as of 1.13.11. */
  pid?: number
}
