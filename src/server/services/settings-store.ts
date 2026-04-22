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
// No external deps — plain node:fs + node:os + node:path.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Logger } from "../util/logger"
import { configFile } from "../util/paths"

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

  function ensureDir(): void {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  function save(patch: Partial<PilotSettings>): PilotSettings {
    ensureDir()
    const current = load()
    const clean = sanitize(patch)
    const merged: PilotSettings = { ...current, ...clean }
    // Remove keys that the patch explicitly set to undefined (not possible via
    // sanitize, but future-proofs us). For now sanitize already drops them.
    const tmp = path + ".tmp"
    writeFileSync(tmp, JSON.stringify(merged, null, 2), { encoding: "utf-8" })
    renameSync(tmp, path)
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
