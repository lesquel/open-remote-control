// Tests for src/server/services/banner.ts — projectStateMode gating.
// Each test uses real tmp dirs (mkdtempSync) and verifies fs state directly.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeBanner, globalBannerPath } from "./banner"

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

  beforeEach(() => {
    dir = tempDir()
  })

  afterEach(() => {
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

  test("directory='' + mode=auto does NOT throw (regression for unguarded join bug)", async () => {
    // Before the fix, join("", ".opencode", "pilot-banner.txt") resolved to a
    // relative path inside the process cwd. With shouldWriteProjectState the
    // empty-string directory short-circuits to false and nothing is written.
    await expect(
      writeBanner({ ...minimalOpts, directory: "", projectStateMode: "auto" }),
    ).resolves.toBeString()
  })
})
