import type { PluginInput } from "@opencode-ai/plugin"
import { appendFileSync } from "fs"
import { join } from "path"

export interface AuditLog {
  log(action: string, details: Record<string, unknown>): void
}

export function createAuditLog(ctx: PluginInput): AuditLog {
  const logPath = join(ctx.directory, ".opencode", "pilot-audit.log")

  function log(action: string, details: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details,
    }

    try {
      appendFileSync(logPath, JSON.stringify(entry) + "\n")
    } catch {
      // Silent fail — don't break the plugin if logging fails
    }

    ctx.client.app
      .log({
        body: {
          service: "opencode-pilot",
          level:
            action.includes("error") || action.includes("failed") ? "warn" : "debug",
          message: `[audit] ${action}`,
          extra: details,
        },
      })
      .catch(() => {})
  }

  return { log }
}
