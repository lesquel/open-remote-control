import type { PluginInput } from "@opencode-ai/plugin"
import { appendFileSync } from "fs"
import { join } from "path"
import { rotateIfNeeded } from "./rotation"
import { redactRecord, redactSecrets } from "../../infra/logging/redact"

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
    const safeAction = String(redactSecrets(action))
    const safeDetails = redactRecord(details)
    const entry = {
      timestamp: new Date().toISOString(),
      action: safeAction,
      ...safeDetails,
    }

    // Throttled rotation check
    writeCount++
    if (writeCount % ROTATION_CHECK_INTERVAL === 0) {
      rotateIfNeeded(logPath, AUDIT_MAX_BYTES)
    }

    let diskWriteFailed = false
    try {
      appendFileSync(logPath, JSON.stringify(entry) + "\n")
    } catch (diskErr) {
      // Disk write failed (e.g. .opencode/ directory removed while plugin is running).
      // This is NOT provably irrelevant — the audit trail is silently lost otherwise.
      // We do NOT throw here (that would crash the calling handler), but we surface
      // the failure as a warn via ctx.client.app.log, which is the only logger
      // available in core/ without importing infra/logger. The app.log call below
      // is the deliberate fallback; we annotate it with a warn level so the TUI
      // shows the disk-write failure instead of silently upgrading it to a normal
      // debug entry.
      diskWriteFailed = true
      const reason = diskErr instanceof Error ? diskErr.message : String(diskErr)
      ctx.client.app
        .log({
          body: {
            service: "opencode-pilot",
            level: "warn",
            message: `[audit] disk write failed for action "${safeAction}"`,
            extra: redactRecord({ action: safeAction, path: logPath, error: reason }),
          },
        })
        .catch(() => {})
    }

    // Only emit the normal app.log entry when the disk write succeeded.
    // If it failed, the warn entry above already carries the action details.
    if (!diskWriteFailed) {
      ctx.client.app
        .log({
          body: {
            service: "opencode-pilot",
            level:
              action.includes("error") || action.includes("failed") ? "warn" : "debug",
            message: `[audit] ${safeAction}`,
            extra: safeDetails,
          },
        })
        .catch(() => {})
    }
  }

  return { log }
}
