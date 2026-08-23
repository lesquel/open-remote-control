// ─── Logger utility ──────────────────────────────────────────────────────────
// Thin wrapper around ctx.client.app.log — provides a structured logger with
// level helpers so services don't need to repeat the boilerplate each time.

import type { PluginInput } from "@opencode-ai/plugin"
import { redactRecord, redactSecrets } from "../logging/redact"

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
  recentErrors?(): readonly RecentLogError[]
}

export interface RecentLogError {
  timestamp: string
  message: unknown
  extra?: Record<string, unknown>
}

type AppLogLevel = "debug" | "info" | "warn" | "error"

export function createLogger(client: PluginInput["client"], service: string): Logger {
  const recentErrors: RecentLogError[] = []
  function log(level: AppLogLevel, msg: string, extra?: Record<string, unknown>): void {
    const message = redactSecrets(msg)
    const safeExtra = extra ? redactRecord(extra) : undefined
    if (level === "error") {
      recentErrors.push({
        timestamp: new Date().toISOString(),
        message,
        ...(safeExtra ? { extra: safeExtra } : {}),
      })
      if (recentErrors.length > 20) recentErrors.splice(0, recentErrors.length - 20)
    }
    client.app
      .log({
        body: {
          service,
          level,
          message: String(message),
          ...(safeExtra ? { extra: safeExtra } : {}),
        },
      })
      .catch(() => {})
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
    recentErrors: () => recentErrors.map((entry) => ({ ...entry, ...(entry.extra ? { extra: { ...entry.extra } } : {}) })),
  }
}
