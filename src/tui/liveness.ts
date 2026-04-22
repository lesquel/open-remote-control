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
//     HTTP GET to `${url}/health` with a 500ms timeout.

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
        method: "GET",
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

/**
 * Result of probing a host:port for a pilot server when no state file exists.
 * Introduced in 1.13.13 for issue #1 — the TUI used to report the same
 * "server not running" toast for three very different situations:
 *
 *   - `pilot`: our plugin IS running (200 /health with our JSON shape) but
 *     the state file is missing. Root cause is usually stale cache or a
 *     permissions issue on `~/.opencode-pilot/`.
 *   - `other`: the port responds but /health is not ours. Something else
 *     grabbed the port before OpenCode booted.
 *   - `none`: nothing is listening on the probed host:port.
 *
 * Distinguishing the three lets /remote print an actionable next step
 * instead of a generic "server not running".
 */
export type HealthProbe =
  | { kind: "pilot"; version?: string; host: string; port: number }
  | { kind: "other"; host: string; port: number; status: number }
  | { kind: "none"; host: string; port: number }

/**
 * Probe a known/guessed host:port for our pilot /health endpoint. Always
 * resolves (never throws). 500ms timeout to stay snappy inside a slash
 * command flow.
 */
export async function probeHealth(host: string, port: number): Promise<HealthProbe> {
  const url = `http://${host}:${port}/health`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 500)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        return { kind: "other", host, port, status: res.status }
      }
      // Our /health returns { status, version, services: {...}, telegram_ok }.
      // `services.sdk` is the most distinctive key — unlikely to collide with
      // a random HTTP service on the same port.
      const body = (await res.json()) as {
        status?: unknown
        version?: unknown
        services?: { sdk?: unknown }
      }
      const looksLikePilot =
        typeof body?.status === "string" &&
        typeof body?.services?.sdk === "string"
      if (looksLikePilot) {
        const version = typeof body.version === "string" ? body.version : undefined
        return { kind: "pilot", version, host, port }
      }
      return { kind: "other", host, port, status: res.status }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { kind: "none", host, port }
  }
}

/**
 * Default host:port the TUI probes when no state file exists. Matches the
 * server-side defaults in `src/server/config.ts` and honors the same env
 * vars (PILOT_HOST / PILOT_PORT) so users who customized the port still
 * get a useful probe result.
 */
export function defaultProbeTarget(): { host: string; port: number } {
  const port = Number(process.env.PILOT_PORT)
  const host = process.env.PILOT_HOST ?? "127.0.0.1"
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 4097,
  }
}
