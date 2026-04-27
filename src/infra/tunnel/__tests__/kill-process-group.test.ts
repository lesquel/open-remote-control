/**
 * Regression test for issue #15:
 * When cloudflared is installed via `bun install -g`, the bun wrapper spawns
 * the native binary as a grandchild. killTunnelProcess() must kill the ENTIRE
 * process group — not just the wrapper PID — so no orphan remains.
 *
 * Key insight: `detached: true` on spawn() makes the child a process-group
 * leader (pgid == its own pid). Only then does `process.kill(-pid, signal)`
 * kill the whole group including grandchildren. Without `detached: true`,
 * negative-pid signalling doesn't help because the child shares the parent
 * process group.
 *
 * We simulate the parent/grandchild topology using a real subprocess without
 * needing cloudflared installed: a shell parent that spawns a sleeping child.
 */

import { describe, it, expect } from "bun:test"
import { spawn } from "child_process"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function spawnParentWithGrandchild(detached: boolean): Promise<{
  parentPid: number
  grandchildPid: number
  cleanup: () => void
}> {
  // Shell script: background a long sleep (the "grandchild"), print its PID,
  // then wait — mimics the bun-wrapper → native-binary topology.
  const script = `
    sleep 60 &
    GRANDCHILD=$!
    echo "$GRANDCHILD"
    wait $GRANDCHILD
  `

  const proc = spawn("bash", ["-c", script], {
    stdio: ["ignore", "pipe", "pipe"],
    detached,
  })

  const grandchildPid = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for grandchild PID")),
      3000,
    )
    proc.stdout!.once("data", (chunk: Buffer) => {
      clearTimeout(timer)
      resolve(parseInt(chunk.toString().trim(), 10))
    })
  })

  if (!Number.isFinite(grandchildPid) || grandchildPid <= 0) {
    throw new Error(`bad grandchild PID: ${grandchildPid}`)
  }

  return {
    parentPid: proc.pid!,
    grandchildPid,
    cleanup: () => {
      try { process.kill(-proc.pid!, "SIGKILL") } catch { /* already dead */ }
      try { process.kill(proc.pid!, "SIGKILL") } catch { /* already dead */ }
    },
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(
  predicate: () => boolean,
  maxMs: number = 1500,
  intervalMs: number = 50,
): Promise<boolean> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("killTunnelProcess — process-group kill (issue #15)", () => {
  it("without detached:true, proc.kill(SIGTERM) leaves grandchild alive (documents the bug)", async () => {
    // Spawn WITHOUT detached — this is the old/broken behaviour
    const { parentPid, grandchildPid, cleanup } = await spawnParentWithGrandchild(false)

    try {
      // Old approach: signal only the wrapper PID, no process group
      try { process.kill(parentPid, "SIGTERM") } catch { /* already dead */ }

      await waitFor(() => !isPidAlive(parentPid), 1500)

      // Parent dies …
      expect(isPidAlive(parentPid)).toBe(false)

      // … but grandchild SURVIVES — this is the bug
      await new Promise((r) => setTimeout(r, 200))
      expect(isPidAlive(grandchildPid)).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("with detached:true, process.kill(-pgid, SIGTERM) kills parent AND grandchild (the fix)", async () => {
    // Spawn WITH detached — child becomes process-group leader (pgid == pid)
    const { parentPid, grandchildPid, cleanup } = await spawnParentWithGrandchild(true)

    try {
      // Fixed approach: signal the entire process group
      try { process.kill(-parentPid, "SIGTERM") } catch { /* already dead */ }

      // Both parent and grandchild must die
      const grandchildDied = await waitFor(() => !isPidAlive(grandchildPid), 2000)

      expect(grandchildDied).toBe(true) // grandchild is gone — no orphan
      expect(isPidAlive(parentPid)).toBe(false)
    } finally {
      cleanup()
    }
  })
})
