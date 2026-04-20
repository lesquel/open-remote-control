// Tests for isServerAlive — the PID-liveness check used by /remote, /remote-control, /pilot-token.
//
// Regression guard: before 1.13.11, the three slash commands trusted the state
// file unconditionally. If the primary process died via SIGKILL or a crash,
// clearState() never ran and the TUI opened the browser to a dead URL with no
// feedback to the user.
//
// isServerAlive(state) must:
//  1. Return true when `state.pid` refers to a live process.
//  2. Return false when `state.pid` refers to a dead process (ESRCH).
//  3. Fall back to an HTTP HEAD to `${state.url}/health` (≤500ms) when
//     state.pid is absent (remote-host scenario).

import { describe, expect, test, mock, afterEach } from "bun:test"
import { isServerAlive } from "../liveness"

// The shape the TUI reads from the state file (must include pid as of 1.13.11)
interface PilotStateLive {
  token: string
  port: number
  host: string
  startedAt: number
  pid: number
}

interface PilotStateNoPid {
  token: string
  port: number
  host: string
  startedAt: number
}

function makeState(overrides: Partial<PilotStateLive> = {}): PilotStateLive {
  return {
    token: "test-token",
    port: 4097,
    host: "127.0.0.1",
    startedAt: Date.now(),
    pid: process.pid, // current process — always alive
    ...overrides,
  }
}

describe("isServerAlive — PID path", () => {
  test("returns true when pid refers to a live process", async () => {
    // process.pid is always alive inside the same process
    const state = makeState({ pid: process.pid })
    const alive = await isServerAlive(state)
    expect(alive).toBe(true)
  })

  test("returns false when pid is dead (ESRCH-style mock)", async () => {
    // Use a PID that does not exist. On Linux PID 1 is init and is never
    // killed by the test process, but we want ESRCH not EPERM, so we use a
    // PID in the high range that is almost certainly unallocated.
    // To make this deterministic we mock process.kill at the module boundary.
    const originalKill = process.kill.bind(process)
    const killMock = mock((_pid: number, _sig: number | string) => {
      const err = Object.assign(new Error("No such process"), { code: "ESRCH" })
      throw err
    })
    // Temporarily replace process.kill
    ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = killMock as typeof process.kill

    try {
      const state = makeState({ pid: 9999999 })
      const alive = await isServerAlive(state)
      expect(alive).toBe(false)
    } finally {
      ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = originalKill
    }
  })

  test("returns false when pid is dead (EPERM means the process exists — different from ESRCH)", async () => {
    // EPERM means we don't have permission to signal it, but the process
    // exists. isServerAlive should return true in that case.
    const originalKill = process.kill.bind(process)
    const killMock = mock((_pid: number, _sig: number | string) => {
      const err = Object.assign(new Error("Operation not permitted"), { code: "EPERM" })
      throw err
    })
    ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = killMock as typeof process.kill

    try {
      const state = makeState({ pid: 9999999 })
      const alive = await isServerAlive(state)
      // EPERM → process exists but we can't signal it → treat as alive
      expect(alive).toBe(true)
    } finally {
      ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = originalKill
    }
  })
})

describe("isServerAlive — HTTP fallback (no pid)", () => {
  test("returns true when /health responds 200", async () => {
    const state: PilotStateNoPid = {
      token: "test-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: Date.now(),
    }

    // Mock global fetch
    const originalFetch = global.fetch
    global.fetch = mock(async (_url: string, _opts?: RequestInit) => {
      return new Response(null, { status: 200 })
    }) as unknown as typeof global.fetch

    try {
      const alive = await isServerAlive(state as PilotStateLive)
      expect(alive).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
  })

  test("returns false when /health request fails (network error)", async () => {
    const state: PilotStateNoPid = {
      token: "test-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: Date.now(),
    }

    const originalFetch = global.fetch
    global.fetch = mock(async (_url: string, _opts?: RequestInit) => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof global.fetch

    try {
      const alive = await isServerAlive(state as PilotStateLive)
      expect(alive).toBe(false)
    } finally {
      global.fetch = originalFetch
    }
  })

  test("returns false when /health responds non-2xx", async () => {
    const state: PilotStateNoPid = {
      token: "test-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: Date.now(),
    }

    const originalFetch = global.fetch
    global.fetch = mock(async (_url: string, _opts?: RequestInit) => {
      return new Response(null, { status: 503 })
    }) as unknown as typeof global.fetch

    try {
      const alive = await isServerAlive(state as PilotStateLive)
      expect(alive).toBe(false)
    } finally {
      global.fetch = originalFetch
    }
  })
})
