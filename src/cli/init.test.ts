// Regression guards for cli/init.ts.
//
// 1.13.14 bug: `isOpencodeRunning()` used `pgrep -f opencode` which matched
// the init process ITSELF (the command line `bunx @lesquel/opencode-pilot
// init` contains the literal string "opencode") and any shell running
// inside a directory whose path contained "opencode". On every clean
// install the function returned `true`, the installer printed the red
// "CACHE NOT REFRESHED" banner, and exited with code 2 — defeating its
// own purpose.
//
// The fix: `pgrep -x opencode` (exact process-name match) plus explicit
// exclusion of self-PID and parent-PID.

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { isOpencodeRunning } from "./init"

describe("isOpencodeRunning — regression guards (1.13.14)", () => {
  test("returns false when no process is named exactly 'opencode'", () => {
    // In the bun-test environment the process name is "bun" (running
    // `bun test`), NOT "opencode". Pre-1.13.14 this test would have
    // failed because `pgrep -f opencode` matched bun's argv which
    // includes the repo path containing "opencode".
    //
    // If this assertion ever fires, verify no stray `opencode` binary
    // is running on the test host before assuming a regression.
    const pgrepProbe = spawnSync("pgrep", ["-x", "opencode"], {
      encoding: "utf8",
    })
    if (pgrepProbe.status === 0 && pgrepProbe.stdout?.trim()) {
      // An actual opencode process IS running on the test host — this
      // is a CI environment concern, not a code regression. Skip with
      // a clear message instead of a confusing failure.
      console.warn(
        `[isOpencodeRunning test] real opencode process detected (pids: ${pgrepProbe.stdout.trim()}), skipping`,
      )
      return
    }
    expect(isOpencodeRunning()).toBe(false)
  })

  test("uses pgrep -x, not pgrep -f (source-level guard)", async () => {
    // Belt-and-suspenders: grep the source file to confirm the -f flag
    // never sneaks back in. A future refactor could "fix" a warning by
    // changing -x back to -f and silently reintroduce the bug.
    const src = await Bun.file(new URL("./init.ts", import.meta.url)).text()
    expect(src).toContain('pgrep", ["-x", "opencode"]')
    expect(src).not.toContain('pgrep", ["-f", "opencode"]')
  })

  test("does not self-detect — excludes current and parent PID", async () => {
    // Semantic guard: even if `pgrep -x opencode` ever returns the
    // current process's PID (can happen on niche systems where a bun
    // wrapper renames argv[0]), we filter it out so isOpencodeRunning
    // never reports "true" as a side effect of running itself.
    const src = await Bun.file(new URL("./init.ts", import.meta.url)).text()
    expect(src).toContain("process.pid")
    expect(src).toContain("process.ppid")
    expect(src).toContain("selfPids")
  })
})
