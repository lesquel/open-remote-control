import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "fs"
import type { TunnelProvider } from "../config"

export type { TunnelProvider }

export interface TunnelConfig {
  provider: TunnelProvider
  port: number
}

export interface TunnelInstance {
  publicUrl: string | null
  provider: TunnelProvider
  stop(): void
}

export async function startTunnel(config: TunnelConfig): Promise<TunnelInstance> {
  if (config.provider === "off") {
    return { publicUrl: null, provider: "off", stop: () => {} }
  }

  if (config.provider === "cloudflared") {
    return startCloudflared(config.port)
  }

  if (config.provider === "ngrok") {
    return startNgrok(config.port)
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
    { stdio: ["ignore", "pipe", "pipe"] },
  )

  const publicUrl = await waitForUrl(proc, /https:\/\/[a-z0-9-]+\.trycloudflare\.com/, 20_000)

  return {
    publicUrl,
    provider: "cloudflared",
    stop: () => {
      try {
        proc.kill()
      } catch {}
    },
  }
}

async function startNgrok(port: number): Promise<TunnelInstance> {
  if (!isCommandAvailable("ngrok")) {
    return { publicUrl: null, provider: "ngrok", stop: () => {} }
  }

  const proc = spawn("ngrok", ["http", `${port}`, "--log=stdout"], {
    stdio: ["ignore", "pipe", "pipe"],
  })

  const publicUrl = await waitForUrl(
    proc,
    /https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app/,
    20_000,
  )

  return {
    publicUrl,
    provider: "ngrok",
    stop: () => {
      try {
        proc.kill()
      } catch {}
    },
  }
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
  const paths = (process.env.PATH ?? "").split(":")
  for (const p of paths) {
    if (existsSync(`${p}/${cmd}`)) return true
  }
  return false
}
