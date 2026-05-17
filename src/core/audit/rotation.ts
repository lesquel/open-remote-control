// ─── Audit Log Rotation ──────────────────────────────────────────────────────
// Rotates log files when they exceed a size threshold.
// Keeps up to 3 rotated files: .log → .log.1 → .log.2 → .log.3 (then dropped).
// Extracted so audit.ts can remain simple and this logic is independently testable.

import { existsSync, statSync, renameSync } from "fs"

/** Max rotated files to keep (not counting the active file). */
const MAX_ROTATIONS = 3

/**
 * Check the active log file size; if > thresholdBytes, rotate.
 * Rotation: .log.2 → .log.3, .log.1 → .log.2, .log → .log.1
 * After rotation, the original file is gone — next appendFileSync creates a fresh one.
 *
 * @param logPath Absolute path to the active log file.
 * @param thresholdBytes Rotate when file size strictly exceeds this value.
 */
export function rotateIfNeeded(logPath: string, thresholdBytes: number): void {
  if (!existsSync(logPath)) return

  let size: number
  try {
    size = statSync(logPath).size
  } catch {
    return
  }

  if (size <= thresholdBytes) return

  // Shift existing rotated files: .2 → .3, .1 → .2
  // If any shift rename fails we bail out of the entire rotation rather than
  // continuing — a partial shift would cause renaming the active log to .1
  // to overwrite .1 with data that .1 was already holding. Log the failure
  // via console.error (core/ has no logger — this runs before one is available)
  // so the problem is at least visible in OpenCode's stderr output.
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`
    const to = `${logPath}.${i + 1}`
    if (existsSync(from)) {
      try {
        renameSync(from, to)
      } catch (err) {
        // Rename failed mid-shift: bail out to avoid a partial rotation that
        // would overwrite .1 with wrong data on the next step.
        const reason = err instanceof Error ? err.message : String(err)
        console.error(`[opencode-pilot] warn: audit rotation aborted — rename ${from} → ${to} failed: ${reason}`)
        return
      }
    }
  }

  // Move active log → .1
  try {
    renameSync(logPath, `${logPath}.1`)
  } catch (err) {
    // Failed to move the active log to .1. Rotation did not complete; the
    // active file will continue to grow until the next rotation attempt.
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[opencode-pilot] warn: audit rotation aborted — rename ${logPath} → ${logPath}.1 failed: ${reason}`)
  }
}
