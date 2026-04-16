// ─── Config module ─────────────────────────────────────────────────────────
// Single source of truth for all env-var configuration.
// Validates at startup and throws ConfigError with clear messages.
// index.ts catches ConfigError, logs a warning, and falls back to defaults.

import { DEFAULT_HOST, DEFAULT_PERMISSION_TIMEOUT_MS, DEFAULT_PORT } from "./constants"

export type TunnelProvider = "off" | "cloudflared" | "ngrok"

export interface TelegramConfig {
  token: string
  chatId: string
}

export interface Config {
  port: number
  host: string
  permissionTimeoutMs: number
  tunnel: TunnelProvider
  telegram: TelegramConfig | null
  /** When true, dashboard HTML is re-read from disk on each request (dev mode). */
  dev: boolean
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function parseTunnelProvider(raw: string | undefined): TunnelProvider {
  if (!raw || raw === "off") return "off"
  if (raw === "cloudflared" || raw === "ngrok") return raw
  throw new ConfigError(
    `Invalid PILOT_TUNNEL value "${raw}". Must be one of: off, cloudflared, ngrok`,
  )
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = parseIntOrDefault(env.PILOT_PORT, DEFAULT_PORT)
  if (port < 1 || port > 65535) {
    throw new ConfigError(`Invalid PILOT_PORT: "${env.PILOT_PORT}". Must be 1–65535.`)
  }

  const host = env.PILOT_HOST ?? DEFAULT_HOST
  const permissionTimeoutMs = parseIntOrDefault(env.PILOT_PERMISSION_TIMEOUT, DEFAULT_PERMISSION_TIMEOUT_MS)
  const tunnel = parseTunnelProvider(env.PILOT_TUNNEL)

  const telegram: TelegramConfig | null =
    env.PILOT_TELEGRAM_TOKEN && env.PILOT_TELEGRAM_CHAT_ID
      ? { token: env.PILOT_TELEGRAM_TOKEN, chatId: env.PILOT_TELEGRAM_CHAT_ID }
      : null

  const dev = env.PILOT_DEV === "true"

  return { port, host, permissionTimeoutMs, tunnel, telegram, dev }
}

/**
 * Load config with graceful fallback: if validation throws ConfigError, log
 * a warning and return defaults. Any other error is re-thrown.
 */
export function loadConfigSafe(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.error,
): Config {
  try {
    return loadConfig(env)
  } catch (err) {
    if (err instanceof ConfigError) {
      warn(`[opencode-pilot] Config warning: ${err.message} — using defaults.`)
      return loadConfig({}) // all defaults
    }
    throw err
  }
}
