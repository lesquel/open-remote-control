// Tests for src/infra/banner/writer.ts — projectStateMode gating.
// Each test uses real tmp dirs (mkdtempSync) and verifies fs state directly.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeBanner, globalBannerPath } from "./writer"

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pilot-banner-test-"))
}

const minimalOpts = {
  localUrl: "http://127.0.0.1:4097",
  publicUrl: null,
  token: "test-token",
} as const

// ── Batch 4 tests: projectStateMode gating ───────────────────────────────────

describe("writeBanner — projectStateMode", () => {
  let dir: string
  let previousXdgStateHome: string | undefined

  beforeEach(() => {
    dir = tempDir()
    previousXdgStateHome = process.env.XDG_STATE_HOME
    process.env.XDG_STATE_HOME = join(dir, "xdg-state")
  })

  afterEach(() => {
    if (previousXdgStateHome === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousXdgStateHome
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  test("mode=off writes global banner and does NOT create <dir>/.opencode/", async () => {
    await writeBanner({ ...minimalOpts, directory: dir, projectStateMode: "off" })

    // Global must exist
    expect(existsSync(globalBannerPath())).toBe(true)
    // Per-project directory must NOT be created
    expect(existsSync(join(dir, ".opencode"))).toBe(false)
  })

  test("mode=always writes per-project pilot-banner.txt even when .opencode/ did not exist", async () => {
    // No .opencode/ exists yet
    expect(existsSync(join(dir, ".opencode"))).toBe(false)

    await writeBanner({ ...minimalOpts, directory: dir, projectStateMode: "always" })

    expect(existsSync(globalBannerPath())).toBe(true)
    expect(existsSync(join(dir, ".opencode", "pilot-banner.txt"))).toBe(true)
  })

  test("mode=auto + no existing .opencode/: skips per-project write; global still written", async () => {
    await writeBanner({ ...minimalOpts, directory: dir, projectStateMode: "auto" })

    expect(existsSync(globalBannerPath())).toBe(true)
    expect(existsSync(join(dir, ".opencode"))).toBe(false)
  })

  test("mode=auto + pre-existing .opencode/: writes per-project banner", async () => {
    mkdirSync(join(dir, ".opencode"), { recursive: true })

    await writeBanner({ ...minimalOpts, directory: dir, projectStateMode: "auto" })

    expect(existsSync(globalBannerPath())).toBe(true)
    expect(existsSync(join(dir, ".opencode", "pilot-banner.txt"))).toBe(true)
  })

  test("mode=always writes private project banner and tightens an existing file", async () => {
    const opencodeDir = join(dir, ".opencode")
    const projectFile = join(opencodeDir, "pilot-banner.txt")
    mkdirSync(opencodeDir, { mode: 0o755 })
    writeFileSync(projectFile, "old", { mode: 0o644 })
    if (process.platform !== "win32") {
      chmodSync(opencodeDir, 0o755)
      chmodSync(projectFile, 0o644)
    }

    const result = await writeBanner({
      ...minimalOpts,
      directory: dir,
      projectStateMode: "always",
    })

    expect(readFileSync(projectFile, "utf8")).toBe(result.banner)
    if (process.platform !== "win32") {
      expect(statSync(opencodeDir).mode & 0o777).toBe(0o700)
      expect(statSync(projectFile).mode & 0o777).toBe(0o600)
      expect(statSync(join(dir, "xdg-state", "opencode-pilot")).mode & 0o777).toBe(0o700)
      expect(statSync(globalBannerPath()).mode & 0o777).toBe(0o600)
    }
  })

  test("returns a visible global write error when private persistence fails", async () => {
    const blockedStateHome = join(dir, "blocked-state-home")
    writeFileSync(blockedStateHome, "not-a-directory")
    process.env.XDG_STATE_HOME = blockedStateHome

    const result = await writeBanner({
      ...minimalOpts,
      directory: dir,
      projectStateMode: "off",
    })

    expect(typeof result.globalWriteError).toBe("string")
    expect(result.globalWriteError?.length).toBeGreaterThan(0)
  })

  test("directory='' + mode=auto does NOT throw (regression for unguarded join bug)", async () => {
    // Before the fix, join("", ".opencode", "pilot-banner.txt") resolved to a
    // relative path inside the process cwd. With shouldWriteProjectState the
    // empty-string directory short-circuits to false and nothing is written.
    const result = await writeBanner({ ...minimalOpts, directory: "", projectStateMode: "auto" })
    expect(typeof result.banner).toBe("string")
  })
})
