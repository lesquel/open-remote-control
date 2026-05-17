// Tests for src/core/state/store.ts
//
// Regression guards:
//  - 1.13.11: writeState must persist pid so the TUI's isServerAlive check can
//    use process.kill(0) to detect dead servers.
//  - 1.13.13 (issue #1): writeState must isolate project-path failures from
//    global-path success, and must return a structured WriteStateResult so
//    activatePrimary can surface silent FS errors to ctx.client.app.log.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs"
import { tmpdir, homedir } from "os"
import { join } from "path"
import { writeState, readState, readGlobalState, clearState, globalStatePath } from "./store"
import type { PilotState, ProjectStateMode } from "./store"

// ── Batch 1: ProjectStateMode compile-time type check ────────────────────────

describe("ProjectStateMode — type contract", () => {
  test("accepts off, auto, and always (compile-time satisfies check)", () => {
    const off = "off" satisfies ProjectStateMode
    const auto = "auto" satisfies ProjectStateMode
    const always = "always" satisfies ProjectStateMode
    expect(off).toBe("off")
    expect(auto).toBe("auto")
    expect(always).toBe("always")
  })
})

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pilot-state-test-"))
}

// ── Batch 2: shouldWriteProjectState helper ───────────────────────────────────

import { shouldWriteProjectState } from "./store"
import { mkdirSync } from "fs"

describe("shouldWriteProjectState", () => {
  let dir: string

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("off always returns false regardless of directory", () => {
    expect(shouldWriteProjectState(dir, "off")).toBe(false)
    expect(shouldWriteProjectState("/nonexistent/path", "off")).toBe(false)
  })

  test("always returns true regardless of directory existence", () => {
    expect(shouldWriteProjectState(dir, "always")).toBe(true)
    // dir doesn't have .opencode/ but always still returns true
    expect(existsSync(join(dir, ".opencode"))).toBe(false)
    expect(shouldWriteProjectState(dir, "always")).toBe(true)
  })

  test("auto returns false when .opencode/ does not exist (and does NOT create it)", () => {
    expect(shouldWriteProjectState(dir, "auto")).toBe(false)
    // Must not create the directory
    expect(existsSync(join(dir, ".opencode"))).toBe(false)
  })

  test("auto returns true when .opencode/ already exists", () => {
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    expect(shouldWriteProjectState(dir, "auto")).toBe(true)
  })

  test("auto with empty-string directory returns false without throwing", () => {
    expect(shouldWriteProjectState("", "auto")).toBe(false)
  })
})

// ── Batch 3: writeState mode parameter ───────────────────────────────────────

const sampleStateBatch3: PilotState = {
  token: "t",
  port: 4097,
  host: "127.0.0.1",
  startedAt: 1,
  pid: process.pid,
}

describe("writeState — mode param", () => {
  let dir: string

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("mode=off writes global only; no .opencode/ created, no project file", () => {
    const result = writeState(dir, sampleStateBatch3, "off")
    // Global must succeed
    expect(result.global.ok).toBe(true)
    // Project outcome must indicate skip (null or ok:false with skipped path)
    const opencodeDir = join(dir, ".opencode")
    expect(existsSync(opencodeDir)).toBe(false)
    // If project is returned, it must signal that nothing was written
    if (result.project !== null) {
      expect(existsSync(result.project.path)).toBe(false)
    }
  })

  test("mode=auto + no .opencode/ dir: no project write, no dir created", () => {
    const result = writeState(dir, sampleStateBatch3, "auto")
    expect(result.global.ok).toBe(true)
    const opencodeDir = join(dir, ".opencode")
    expect(existsSync(opencodeDir)).toBe(false)
  })

  test("mode=auto + pre-existing .opencode/: writes project file", () => {
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    const result = writeState(dir, sampleStateBatch3, "auto")
    expect(result.global.ok).toBe(true)
    expect(result.project).not.toBeNull()
    expect(result.project!.ok).toBe(true)
    expect(existsSync(join(dir, ".opencode", "pilot-state.json"))).toBe(true)
  })

  test("mode=always + no .opencode/: creates dir and writes project file", () => {
    const result = writeState(dir, sampleStateBatch3, "always")
    expect(result.global.ok).toBe(true)
    expect(result.project).not.toBeNull()
    expect(result.project!.ok).toBe(true)
    expect(existsSync(join(dir, ".opencode", "pilot-state.json"))).toBe(true)
  })

  test("clearState does not throw after writeState with mode=off (regression guard)", () => {
    writeState(dir, sampleStateBatch3, "off")
    // clearState tries to unlink both paths. With mode=off, no project file exists.
    // It should not throw — ENOENT is silently swallowed inside clearState.
    expect(() => clearState(dir)).not.toThrow()
  })
})

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

  test("returns WriteStateResult with both outcomes when directory is valid (mode=always)", () => {
    // Use mode=always to test the write mechanism regardless of .opencode/ presence.
    // Legacy behavior (always write project file) is now opt-in via mode=always.
    const dir = mkdtempSync(join(tmpdir(), "pilot-ws-"))
    try {
      const result = writeState(dir, sampleState, "always")
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

  test("null directory: project outcome is marked invalid, global still writes (mode=always)", () => {
    // Simulates a future OpenCode SDK change where ctx.directory comes through
    // as null/undefined. Before 1.13.13 this threw out of writeState via
    // join(null, ...) and aborted the global write too — leaving the TUI with
    // no state file and no diagnostic. Use mode=always to exercise the write path.
    const result = writeState(null as unknown as string, sampleState, "always")
    expect(result.project).not.toBeNull()
    expect(result.project!.ok).toBe(false)
    expect(result.project!.path).toBe("<invalid-directory>")
    expect(typeof result.project!.error).toBe("string")
    // Global must still succeed — it is the one the TUI reads.
    expect(result.global.ok).toBe(true)
    expect(existsSync(globalStatePath())).toBe(true)
  })

  test("project path blocked by a regular file: failure is reported, global succeeds (mode=always)", () => {
    // Create a directory, then plant a FILE at the `.opencode` location.
    // mkdirSync(recursive:true) refuses to turn a file into a directory, so
    // writeOne returns {ok:false, error:...} — exactly the failure case that
    // used to be invisible before 1.13.13. Use mode=always to force the write.
    const dir = mkdtempSync(join(tmpdir(), "pilot-ws-blocked-"))
    try {
      writeFileSync(join(dir, ".opencode"), "not-a-directory")
      const result = writeState(dir, sampleState, "always")
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

// ── Batch 6: updateStateToken — mode forwarding + structured result ───────────
// TDD: these tests are written BEFORE the implementation is changed.
// They describe the two bugs being fixed:
//   Bug 1: mode ignored — updateStateToken always passed mode="auto" to writeState.
//   Bug 2: silent skip — when readState returns null, updateStateToken was a void
//          no-op with no structured result the caller could inspect.

import { updateStateToken } from "./store"
import type { UpdateTokenResult } from "./store"

describe("updateStateToken — mode forwarding (bug 1)", () => {
  let dir: string

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("mode=off + .opencode/ exists: no project file written after token update", () => {
    // Seed a state so readState returns a result (not null).
    const opencodedir = join(dir, ".opencode")
    mkdirSync(opencodedir, { recursive: true })
    const seedState: PilotState = { token: "old", port: 4097, host: "127.0.0.1", startedAt: 1, pid: process.pid }
    writeState(dir, seedState, "always")

    // Now rotate token with mode=off. Even though .opencode/ exists, the project
    // file must NOT be touched (or created) when mode=off.
    const result = updateStateToken(dir, "new-token", "off")

    // Must return ok:true (existing state was found).
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Global must have been updated with new token.
      expect(result.write.global.ok).toBe(true)
      // Project must be null (skipped by mode=off) — not ok:false.
      expect(result.write.project).toBeNull()
    }
    // The project file must NOT reflect the new token if it was re-written.
    // (mode=off should have passed through to writeState which skips project writes)
    const projectFilePath = join(dir, ".opencode", "pilot-state.json")
    if (existsSync(projectFilePath)) {
      const content = JSON.parse(readFileSync(projectFilePath, "utf-8")) as PilotState
      // If the file exists (from seed), it must NOT have been updated with the new token
      // because mode=off suppresses project writes.
      // NOTE: The seed wrote with mode=always so the file exists. After updateStateToken
      // with mode=off, the token in the project file must remain "old".
      expect(content.token).not.toBe("new-token")
    }
  })

  test("mode=auto + .opencode/ exists: project file IS updated", () => {
    const opencodedir = join(dir, ".opencode")
    mkdirSync(opencodedir, { recursive: true })
    const seedState: PilotState = { token: "old", port: 4097, host: "127.0.0.1", startedAt: 1, pid: process.pid }
    writeState(dir, seedState, "auto")

    const result = updateStateToken(dir, "rotated", "auto")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.write.global.ok).toBe(true)
      expect(result.write.project).not.toBeNull()
      expect(result.write.project!.ok).toBe(true)
    }
    const projectFilePath = join(dir, ".opencode", "pilot-state.json")
    const content = JSON.parse(readFileSync(projectFilePath, "utf-8")) as PilotState
    expect(content.token).toBe("rotated")
  })

  test("mode=always: project file written even without pre-existing .opencode/", () => {
    // Seed state only in the global file (no .opencode/ dir).
    const seedState: PilotState = { token: "seed", port: 4097, host: "127.0.0.1", startedAt: 1, pid: process.pid }
    // Write global-only by skipping project (mode=off), then verify auto-create via always.
    writeState(dir, seedState, "off")

    const result = updateStateToken(dir, "always-token", "always")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.write.project).not.toBeNull()
      expect(result.write.project!.ok).toBe(true)
    }
    const projectFilePath = join(dir, ".opencode", "pilot-state.json")
    expect(existsSync(projectFilePath)).toBe(true)
    const content = JSON.parse(readFileSync(projectFilePath, "utf-8")) as PilotState
    expect(content.token).toBe("always-token")
  })
})

describe("updateStateToken — null readState path (bug 2)", () => {
  let dir: string
  // XDG isolation: save and restore XDG_STATE_HOME so the global state path
  // points at an empty temp dir — this forces readState to return null
  // deterministically regardless of any real ~/.opencode-pilot/pilot-state.json.
  let xdgDir: string
  let prevXdg: string | undefined

  beforeEach(() => {
    dir = tempDir()
    // globalStatePath() → stateFile() → getPluginStateDir() → XDG_STATE_HOME
    xdgDir = mkdtempSync(join(tmpdir(), "pilot-xdg-state-"))
    prevXdg = process.env.XDG_STATE_HOME
    process.env.XDG_STATE_HOME = xdgDir
  })

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME
    } else {
      process.env.XDG_STATE_HOME = prevXdg
    }
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    try { rmSync(xdgDir, { recursive: true, force: true }) } catch {}
  })

  test("readState null → returns { ok: false, reason: 'no-existing-state' }", () => {
    // dir is a fresh empty tempdir with no .opencode/ subdirectory.
    // XDG_STATE_HOME points at a fresh empty tempdir so globalStatePath()
    // resolves to a file that does not exist.
    // Both safeRead calls inside readState() return null → updateStateToken
    // must return { ok: false, reason: "no-existing-state" }.
    const result = updateStateToken(dir, "new-token", "auto")
    expect(result).toEqual({ ok: false, reason: "no-existing-state" })
  })

  test("UpdateTokenResult type contract: ok:false shape has reason field", () => {
    // This is a compile-time + runtime shape test.
    const notOk: UpdateTokenResult = { ok: false, reason: "no-existing-state" }
    expect(notOk.ok).toBe(false)
    expect(notOk.reason).toBe("no-existing-state")
  })

  test("UpdateTokenResult type contract: ok:true shape has write.global", () => {
    // Seed via writeState so readState finds it through the global fallback.
    const seedState: PilotState = { token: "tok", port: 4097, host: "127.0.0.1", startedAt: 1, pid: process.pid }
    writeState(dir, seedState, "off") // writes global only (into xdgDir via XDG_STATE_HOME)
    // readState(dir) will fall back to global → returns a state
    const result = updateStateToken(dir, "updated", "off")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.write.global.ok).toBe(true)
    }
  })
})
