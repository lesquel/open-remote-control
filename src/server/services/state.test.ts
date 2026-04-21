// Tests for src/server/services/state.ts
//
// Regression guards:
//  - 1.13.11: writeState must persist pid so the TUI's isServerAlive check can
//    use process.kill(0) to detect dead servers.
//  - 1.13.13 (issue #1): writeState must isolate project-path failures from
//    global-path success, and must return a structured WriteStateResult so
//    activatePrimary can surface silent FS errors to ctx.client.app.log.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs"
import { tmpdir, homedir } from "os"
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

// ── 1.13.13 (issue #1): structured WriteStateResult + failure isolation ─────

describe("writeState WriteStateResult — failure isolation (1.13.13)", () => {
  const sampleState: PilotState = {
    token: "t",
    port: 4097,
    host: "127.0.0.1",
    startedAt: 1,
    pid: process.pid,
  }

  test("returns WriteStateResult with both outcomes when directory is valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-ws-"))
    try {
      const result = writeState(dir, sampleState)
      expect(result.project).not.toBeNull()
      expect(result.project!.ok).toBe(true)
      expect(result.project!.path).toBe(join(dir, ".opencode", "pilot-state.json"))
      expect(result.global.ok).toBe(true)
      expect(result.global.path).toBe(globalStatePath())
      expect(existsSync(result.project!.path)).toBe(true)
      expect(existsSync(result.global.path)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("null directory: project outcome is marked invalid, global still writes", () => {
    // Simulates a future OpenCode SDK change where ctx.directory comes through
    // as null/undefined. Before 1.13.13 this threw out of writeState via
    // join(null, ...) and aborted the global write too — leaving the TUI with
    // no state file and no diagnostic.
    const result = writeState(null as unknown as string, sampleState)
    expect(result.project).not.toBeNull()
    expect(result.project!.ok).toBe(false)
    expect(result.project!.path).toBe("<invalid-directory>")
    expect(typeof result.project!.error).toBe("string")
    // Global must still succeed — it is the one the TUI reads.
    expect(result.global.ok).toBe(true)
    expect(existsSync(globalStatePath())).toBe(true)
  })

  test("project path blocked by a regular file: failure is reported, global succeeds", () => {
    // Create a directory, then plant a FILE at the `.opencode` location.
    // mkdirSync(recursive:true) refuses to turn a file into a directory, so
    // writeOne returns {ok:false, error:...} — exactly the failure case that
    // used to be invisible before 1.13.13.
    const dir = mkdtempSync(join(tmpdir(), "pilot-ws-blocked-"))
    try {
      writeFileSync(join(dir, ".opencode"), "not-a-directory")
      const result = writeState(dir, sampleState)
      expect(result.project).not.toBeNull()
      expect(result.project!.ok).toBe(false)
      expect(typeof result.project!.error).toBe("string")
      expect(result.global.ok).toBe(true)
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  test("global path write keeps working regardless of project-path outcome", () => {
    // Sanity: the TUI's readGlobalState() resolves to the same file writeState
    // writes to. This test verifies the contract end-to-end (what writeState
    // writes, readGlobalState reads).
    const result = writeState("/definitely/not/a/real/path/xyz-123", sampleState)
    // Project write may succeed or fail depending on FS permissions of /;
    // the invariant is that global ALWAYS works under a normal $HOME.
    expect(result.global.ok).toBe(true)
    const read = readGlobalState()
    expect(read).not.toBeNull()
    expect(read!.token).toBe(sampleState.token)
    expect(read!.pid).toBe(sampleState.pid)
  })

  test("state file under $HOME is always the globalStatePath", () => {
    // Regression guard: globalStatePath() must stay anchored to homedir().
    // The TUI's readPilotState hardcodes this same path resolution, so any
    // drift breaks cross-module contract without a type error.
    expect(globalStatePath().startsWith(homedir())).toBe(true)
    expect(globalStatePath().endsWith(join(".opencode-pilot", "pilot-state.json"))).toBe(true)
  })
})
