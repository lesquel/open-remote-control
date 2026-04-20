// Tests that the three TUI slash commands (/remote, /remote-control, /pilot-token)
// short-circuit with a clear user message when the state file exists but the
// server process is dead.
//
// Regression guard for 1.13.11: before this fix the commands trusted the state
// file unconditionally, so a SIGKILL'd primary caused /remote to open the
// browser to a dead URL with no feedback.

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { checkLivenessForTest } from "../liveness"
import type { PilotState } from "../types"

// We test the liveness integration at the unit level: the function
// checkLivenessForTest is the same logic the commands use, extracted so it
// can be tested without a real TuiPluginApi.
//
// If that export doesn't exist the tests fail (compile error) — forcing the
// implementation to expose it.

function makeDeadState(): PilotState {
  return {
    token: "test-token",
    port: 4097,
    host: "127.0.0.1",
    startedAt: Date.now(),
    pid: 9999999, // almost certainly not a real PID
  }
}

function makeLiveState(): PilotState {
  return {
    token: "test-token",
    port: 4097,
    host: "127.0.0.1",
    startedAt: Date.now(),
    pid: process.pid, // current process — always alive
  }
}

describe("checkLivenessForTest — dead pid", () => {
  let originalKill: typeof process.kill

  beforeEach(() => {
    originalKill = process.kill.bind(process)
  })

  afterEach(() => {
    ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = originalKill
  })

  test("returns { alive: false, message: string } for dead pid", async () => {
    ;(process as NodeJS.Process & { kill: typeof process.kill }).kill = mock(
      (_pid: number, _sig: number | string) => {
        const err = Object.assign(new Error("No such process"), { code: "ESRCH" })
        throw err
      },
    ) as typeof process.kill

    const result = await checkLivenessForTest(makeDeadState())
    expect(result.alive).toBe(false)
    expect(typeof result.message).toBe("string")
    expect(result.message.length).toBeGreaterThan(0)
    // Must guide the user toward a fix
    expect(result.message.toLowerCase()).toMatch(/not running|start|instance|take over/)
  })

  test("returns { alive: true } for live pid", async () => {
    const result = await checkLivenessForTest(makeLiveState())
    expect(result.alive).toBe(true)
  })
})

describe("checkLivenessForTest — no pid (HTTP fallback)", () => {
  test("returns { alive: false } when HTTP probe fails", async () => {
    const state: PilotState = {
      token: "test-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: Date.now(),
      // no pid
    }

    const originalFetch = global.fetch
    global.fetch = mock(async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof global.fetch

    try {
      const result = await checkLivenessForTest(state)
      expect(result.alive).toBe(false)
    } finally {
      global.fetch = originalFetch
    }
  })

  test("returns { alive: true } when HTTP probe succeeds", async () => {
    const state: PilotState = {
      token: "test-token",
      port: 4097,
      host: "127.0.0.1",
      startedAt: Date.now(),
      // no pid
    }

    const originalFetch = global.fetch
    global.fetch = mock(async () => new Response(null, { status: 200 })) as unknown as typeof global.fetch

    try {
      const result = await checkLivenessForTest(state)
      expect(result.alive).toBe(true)
    } finally {
      global.fetch = originalFetch
    }
  })
})
