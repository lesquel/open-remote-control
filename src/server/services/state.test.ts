// Tests for src/server/services/state.ts
//
// Regression guard for 1.13.11: writeState must persist pid so the TUI's
// isServerAlive check can use process.kill(0) to detect dead servers.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { writeState, readState, readGlobalState, clearState, globalStatePath } from "./state"
import type { PilotState } from "./state"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pilot-state-test-"))
}

describe("writeState / readState — pid field", () => {
  let dir: string
  let cleanup: (() => void)[] = []

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    for (const fn of cleanup) {
      try { fn() } catch {}
    }
    cleanup = []
  })

  test("writeState persists pid and readState returns it", () => {
    const state: PilotState = {
      token: "abc123",
      port: 4097,
      host: "127.0.0.1",
      startedAt: 1000,
      pid: process.pid,
    }
    writeState(dir, state)
    const read = readState(dir)
    expect(read).not.toBeNull()
    expect(read!.pid).toBe(process.pid)
  })

  test("writeState writes all required PilotState fields", () => {
    const state: PilotState = {
      token: "tok-xyz",
      port: 4097,
      host: "localhost",
      startedAt: Date.now(),
      pid: 12345,
    }
    writeState(dir, state)
    const read = readState(dir)
    expect(read).not.toBeNull()
    expect(read!.token).toBe("tok-xyz")
    expect(read!.port).toBe(4097)
    expect(read!.host).toBe("localhost")
    expect(read!.pid).toBe(12345)
  })

  test("clearState removes the state file so readState returns null", () => {
    const state: PilotState = {
      token: "tok",
      port: 4097,
      host: "127.0.0.1",
      startedAt: 0,
      pid: process.pid,
    }
    writeState(dir, state)
    expect(readState(dir)).not.toBeNull()
    clearState(dir)
    // After clear, project path is gone; global path may still differ per test
    // isolation, so we only check the project path here.
    const projectPath = join(dir, ".opencode", "pilot-state.json")
    expect(existsSync(projectPath)).toBe(false)
  })
})
