// ─── Settings Store ──────────────────────────────────────────────────────────
// Persistent JSON config written by the Settings UI.
// Lives at ~/.opencode-pilot/config.json and survives plugin restarts.
//
// Layered config priority (highest wins):
//   1. Shell env vars — runtime override, never written by the UI
//   2. This JSON store — editable from the dashboard Settings UI
//   3. .env files     — power-user file-based config
//   4. Hardcoded defaults in config.ts
//
// Writes are atomic (write-then-rename) so a crash during save cannot
// corrupt the file.
//
// Schema version intentionally omitted for v1 — we'll add one the first time
// we need to rename or remove a field.
//
// Sensitive writes use the shared private atomic-file helper from infra/.

import { existsSync, readFileSync, unlinkSync } from "node:fs"
import type { Logger } from "../../infra/logger/index"
import { writePrivateFile } from "../../infra/fs/private-file"
import { configFile } from "../../infra/paths/index"

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Subset of Config that is editable from the Settings UI and persisted to
 * ~/.opencode-pilot/config.json. Fields are optional — omitted keys mean
 * "not set" and fall through to the next priority layer (.env, defaults).
 *
 * Shape intentionally mirrors what the dashboard sends and what config.ts
 * consumes. When adding a field here, also:
 *   - add it to PERSISTED_KEYS below (otherwise it won't round-trip)
 *   - wire it into config.ts::mergeStoredSettings()
 *   - add a source entry in handlers.ts::getEffectiveSettings()
 */
export interface PilotSettings {
  port?: number
  host?: string
  permissionTimeoutMs?: number
  tunnel?: "cloudflared" | "ngrok" | "off"
  telegramToken?: string
  telegramChatId?: string
  vapidPublicKey?: string
  vapidPrivateKey?: string
  vapidSubject?: string
  enableGlobOpener?: boolean
  fetchTimeoutMs?: number
  projectStateMode?: "off" | "auto" | "always"
  /** Optional token accepted on POST /codex/hooks/* endpoints (in addition to main token). */
  hookToken?: string
}

/** Whitelist of keys we actually write to disk. Unknown keys are dropped. */
const PERSISTED_KEYS: ReadonlyArray<keyof PilotSettings> = [
  "port",
  "host",
  "permissionTimeoutMs",
  "tunnel",
  "telegramToken",
  "telegramChatId",
  "vapidPublicKey",
  "vapidPrivateKey",
  "vapidSubject",
  "enableGlobOpener",
  "fetchTimeoutMs",
  "projectStateMode",
  "hookToken",
]

// ─── Store ───────────────────────────────────────────────────────────────────

export interface SettingsStore {
  /** Read the JSON file. Returns {} if missing or unparsable. */
  load(): PilotSettings
  /** Shallow-merge partial settings into the stored value and persist. */
  save(patch: Partial<PilotSettings>): PilotSettings
  /** Delete the JSON file (no-op if missing). */
  reset(): void
  /** Absolute path to the JSON file (useful for diagnostics and UI hints). */
  filePath(): string
}

export interface SettingsStoreDeps {
  logger: Logger
  /**
   * Override the file path — used by tests to avoid polluting the real
   * ~/.opencode-pilot/config.json. Defaults to ~/.opencode-pilot/config.json.
   */
  filePath?: string
}

function defaultFilePath(): string {
  return configFile("config.json")
}

/** Strip unknown keys and invalid types so a malformed file can't poison config. */
function sanitize(raw: unknown): PilotSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const src = raw as Record<string, unknown>
  const out: PilotSettings = {}
  for (const key of PERSISTED_KEYS) {
    const v = src[key]
    if (v === undefined || v === null) continue
    switch (key) {
      case "port":
      case "permissionTimeoutMs":
      case "fetchTimeoutMs":
        if (typeof v === "number" && Number.isFinite(v)) out[key] = v
        break
      case "enableGlobOpener":
        if (typeof v === "boolean") out[key] = v
        break
      case "tunnel":
        if (v === "off" || v === "cloudflared" || v === "ngrok") out[key] = v
        break
      case "projectStateMode":
        if (v === "off" || v === "auto" || v === "always") out[key] = v
        break
      case "hookToken":
        // Allow non-empty string (set) or treat missing/null as unset.
        // Empty string is treated as "clear" — stored as undefined.
        if (typeof v === "string" && v.length > 0) out[key] = v
        break
      default:
        if (typeof v === "string") out[key] = v
    }
  }
  return out
}

export function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const path = deps.filePath ?? defaultFilePath()
  const { logger } = deps

  function load(): PilotSettings {
    if (!existsSync(path)) return {}
    try {
      const raw = readFileSync(path, "utf-8")
      if (raw.trim().length === 0) return {}
      const parsed: unknown = JSON.parse(raw)
      return sanitize(parsed)
    } catch (err) {
      logger.warn("settings-store: failed to read, treating as empty", {
        path,
        error: err instanceof Error ? err.message : String(err),
      })
      return {}
    }
  }

  function save(patch: Partial<PilotSettings>): PilotSettings {
    const current = load()
    const clean = sanitize(patch)
    const merged: PilotSettings = { ...current, ...clean }
    for (const key of PERSISTED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] === undefined) {
        delete merged[key]
      }
    }
    // The HTTP validator maps hookToken:null to an empty-string clear sentinel.
    // sanitize() intentionally refuses to persist it, so deletion must happen
    // against the merged object rather than silently resurrecting the old value.
    if (Object.prototype.hasOwnProperty.call(patch, "hookToken") && patch.hookToken === "") {
      delete merged.hookToken
    }
    writePrivateFile(path, `${JSON.stringify(merged, null, 2)}\n`)
    return merged
  }

  function reset(): void {
    try {
      unlinkSync(path)
    } catch (err) {
      // ENOENT is fine — nothing to delete
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== "ENOENT") {
        logger.warn("settings-store: reset failed", {
          path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  function filePath(): string {
    return path
  }

  return { load, save, reset, filePath }
}
