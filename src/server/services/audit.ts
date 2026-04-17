import type { PluginInput } from "@opencode-ai/plugin"
import { appendFileSync } from "fs"
import { join } from "path"
import { rotateIfNeeded } from "./audit-rotation"

export interface AuditLog {
  log(action: string, details: Record<string, unknown>): void
}

/** Rotate when audit log exceeds 5 MB. */
const AUDIT_MAX_BYTES = 5 * 1024 * 1024

/**
 * Throttle rotation checks: only check every N writes to avoid
 * stat() on every log call in hot paths.
 */
const ROTATION_CHECK_INTERVAL = 50

export function createAuditLog(ctx: PluginInput): AuditLog {
  const logPath = join(ctx.directory, ".opencode", "pilot-audit.log")
  let writeCount = 0

  function log(action: string, details: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...details,
    }

    // Throttled rotation check
    writeCount++
    if (writeCount % ROTATION_CHECK_INTERVAL === 0) {
      rotateIfNeeded(logPath, AUDIT_MAX_BYTES)
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
