// ─── Audit Log Rotation ──────────────────────────────────────────────────────
// Rotates log files when they exceed a size threshold.
// Keeps up to 3 rotated files: .log → .log.1 → .log.2 → .log.3 (then dropped).
// Extracted so audit.ts can remain simple and this logic is independently testable.

import { existsSync, statSync, renameSync, unlinkSync } from "fs"

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
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`
    const to = `${logPath}.${i + 1}`
    if (existsSync(from)) {
      try {
        renameSync(from, to)
      } catch {}
    }
  }

  // Move active log → .1
  try {
    renameSync(logPath, `${logPath}.1`)
  } catch {}
}
