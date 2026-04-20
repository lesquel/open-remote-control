// liveness.ts — PID and HTTP liveness checks for the TUI slash commands.
//
// Introduced in 1.13.11 to fix the stale-state bug: if the primary pilot
// process dies via SIGKILL or a crash, clearState() never runs. The state
// file still points at a dead PID. Without this check, /remote opens the
// browser to a dead URL with zero user feedback.
//
// Algorithm:
//  1. If state.pid is present (same-host case): call process.kill(pid, 0).
//     - No error          → process is alive.
//     - ESRCH             → process is dead → return false.
//     - EPERM             → process exists but we can't signal it → return true.
//     - Any other error   → conservatively return false.
//  2. If state.pid is absent (remote-host / older state-file): fall back to an
//     HTTP HEAD to `${url}/health` with a 500ms timeout.

import type { PilotState } from "./types"

/**
 * Result shape returned by checkLivenessForTest — and used internally by the
 * slash commands to decide whether to proceed or short-circuit.
 */
export interface LivenessResult {
  alive: boolean
  /** Human-readable message to show the user when `alive` is false. */
  message: string
}

/**
 * Returns true when the pilot server described by `state` appears to be alive.
 * Always resolves (never throws).
 */
export async function isServerAlive(state: PilotState): Promise<boolean> {
  if (state.pid) {
    return pidIsAlive(state.pid)
  }
  // No pid field — fall back to HTTP probe
  const url = `http://${state.host}:${state.port}/health`
  return httpIsAlive(url)
}

function pidIsAlive(pid: number): boolean {
  try {
    // Signal 0 does not send a real signal — it just checks whether the
    // process exists and we have permission to signal it.
    process.kill(pid, 0)
    return true // no error → alive
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "EPERM") {
      // Process exists but we don't own it — treat as alive.
      return true
    }
    // ESRCH (no such process) or anything else → dead
    return false
  }
}

/**
 * Convenience wrapper used by slash commands and tests.
 * Returns the liveness result with a ready-to-display user message.
 */
export async function checkLivenessForTest(state: PilotState): Promise<LivenessResult> {
  const alive = await isServerAlive(state)
  if (alive) {
    return { alive: true, message: "" }
  }
  return {
    alive: false,
    message:
      "Pilot server not running — start OpenCode again or wait for another instance to take over.",
  }
}

async function httpIsAlive(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 500)
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
