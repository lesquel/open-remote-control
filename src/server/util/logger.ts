// ─── Logger utility ──────────────────────────────────────────────────────────
// Thin wrapper around ctx.client.app.log — provides a structured logger with
// level helpers so services don't need to repeat the boilerplate each time.

import type { PluginInput } from "@opencode-ai/plugin"

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

type AppLogLevel = "debug" | "info" | "warn" | "error"

export function createLogger(client: PluginInput["client"], service: string): Logger {
  function log(level: AppLogLevel, msg: string, extra?: Record<string, unknown>): void {
    client.app
      .log({
        body: {
          service,
          level,
          message: msg,
          ...(extra ? { extra } : {}),
        },
      })
      .catch(() => {})
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
  }
}
