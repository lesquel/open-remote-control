import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "fs"
import { delimiter } from "path"
import type { TunnelProvider } from "./types"
import { TUNNEL_URL_PATTERNS, TUNNEL_START_TIMEOUT_MS, TUNNEL_KILL_GRACE_MS } from "./constants"

export type { TunnelProvider }

export type TunnelStatus = "off" | "starting" | "connected" | "failed"

export interface TunnelConfig {
  provider: TunnelProvider
  port: number
}

export interface TunnelInstance {
  publicUrl: string | null
  provider: TunnelProvider
  stop(): void
}

export interface TunnelInfo {
  provider: TunnelProvider | null
  url: string | null
  status: TunnelStatus
}

// ─── Module-scoped tunnel state ──────────────────────────────────────────────
// Exported so /connect-info can read current truth without needing deps.

let _tunnelInfo: TunnelInfo = { provider: null, url: null, status: "off" }

/** Get the current tunnel connection state. */
export function getTunnelInfo(): TunnelInfo {
  return { ..._tunnelInfo }
}

export async function startTunnel(config: TunnelConfig): Promise<TunnelInstance> {
  if (config.provider === "off") {
    _tunnelInfo = { provider: null, url: null, status: "off" }
    return { publicUrl: null, provider: "off", stop: () => {} }
  }

  if (config.provider === "cloudflared") {
    _tunnelInfo = { provider: "cloudflared", url: null, status: "starting" }
    const instance = await startCloudflared(config.port)
    _tunnelInfo = {
      provider: "cloudflared",
      url: instance.publicUrl,
      status: instance.publicUrl !== null ? "connected" : "failed",
    }
    return instance
  }

  if (config.provider === "ngrok") {
    _tunnelInfo = { provider: "ngrok", url: null, status: "starting" }
    const instance = await startNgrok(config.port)
    _tunnelInfo = {
      provider: "ngrok",
      url: instance.publicUrl,
      status: instance.publicUrl !== null ? "connected" : "failed",
    }
    return instance
  }

  // TypeScript exhaustive check
  const _never: never = config.provider
  throw new Error(`Unknown tunnel provider: ${_never}`)
}

async function startCloudflared(port: number): Promise<TunnelInstance> {
  if (!isCommandAvailable("cloudflared")) {
    return { publicUrl: null, provider: "cloudflared", stop: () => {} }
  }

  const proc = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    // detached: true makes the child a process-group leader (pgid == pid).
    // This is required so that process.kill(-pid, signal) in killTunnelProcess
    // signals the entire group — including any grandchild spawned by the bun
    // wrapper when cloudflared is installed via `bun install -g` (issue #15).
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  )
  // Unref so our process can exit without waiting for cloudflared.
  proc.unref()

  const publicUrl = await waitForUrl(proc, TUNNEL_URL_PATTERNS.cloudflared, TUNNEL_START_TIMEOUT_MS)

  return {
    publicUrl,
    provider: "cloudflared",
    stop: () => killTunnelProcess(proc, () => {
      _tunnelInfo = { provider: "cloudflared", url: null, status: "off" }
    }),
  }
}

async function startNgrok(port: number): Promise<TunnelInstance> {
  if (!isCommandAvailable("ngrok")) {
    return { publicUrl: null, provider: "ngrok", stop: () => {} }
  }

  // detached: true — same rationale as cloudflared (issue #15): makes the child
  // a process-group leader so killTunnelProcess can signal the whole group.
  const proc = spawn("ngrok", ["http", `${port}`, "--log=stdout"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  proc.unref()

  const publicUrl = await waitForUrl(
    proc,
    TUNNEL_URL_PATTERNS.ngrok,
    TUNNEL_START_TIMEOUT_MS,
  )

  return {
    publicUrl,
    provider: "ngrok",
    stop: () => killTunnelProcess(proc, () => {
      _tunnelInfo = { provider: "ngrok", url: null, status: "off" }
    }),
  }
}

// Aggressively kill a tunnel child and its entire process group. Some providers
// (cloudflared in particular) re-spawn or hold their socket long enough that a
// polite SIGTERM is slow — if the parent OpenCode process is closing a window,
// the tunnel must die now, not eventually.
//
// When the child was spawned with `detached: true` (which we do for cloudflared
// and ngrok) it becomes its own process-group leader with pgid == pid. Sending
// SIGTERM to the negative PID signals every process in that group — including
// any grandchild spawned by the bun wrapper when the tool is installed via
// `bun install -g` (issue #15). We SIGTERM the group first, then SIGKILL the
// group at 400 ms if anything is still breathing, then run the on-dead callback.
function killTunnelProcess(proc: ChildProcess, onDead: () => void): void {
  if (proc.exitCode !== null || proc.killed) {
    onDead()
    return
  }
  const pid = proc.pid
  const sendSignal = (sig: NodeJS.Signals) => {
    if (pid === undefined) return
    // Prefer process-group kill (negative PID) so grandchildren are included.
    // Fall back to proc.kill() if the group signal throws (e.g. ESRCH when the
    // process is already gone, or EPERM in a restricted sandbox).
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        proc.kill(sig)
      } catch {
        // already gone — ignore
      }
    }
  }
  sendSignal("SIGTERM")
  const killTimer = setTimeout(() => {
    if (proc.exitCode === null && !proc.killed) {
      sendSignal("SIGKILL")
    }
  }, TUNNEL_KILL_GRACE_MS)
  const onExit = () => {
    clearTimeout(killTimer)
    onDead()
  }
  proc.once("exit", onExit)
  proc.once("close", onExit)
}

function waitForUrl(
  proc: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        resolve(null)
      }
    }, timeoutMs)

    function scan(chunk: Buffer): void {
      const text = chunk.toString()
      const match = text.match(pattern)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(match[0])
      }
    }

    proc.stdout?.on("data", scan)
    proc.stderr?.on("data", scan)

    proc.on("exit", () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(null)
      }
    })
  })
}

function isCommandAvailable(cmd: string): boolean {
  const paths = (process.env.PATH ?? "").split(delimiter)
  for (const p of paths) {
    if (existsSync(`${p}/${cmd}`)) return true
  }
  return false
}
