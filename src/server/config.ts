// ─── Config module ─────────────────────────────────────────────────────────
// Single source of truth for all env-var configuration.
// Validates at startup and throws ConfigError with clear messages.
// index.ts catches ConfigError, logs a warning, and falls back to defaults.
//
// Priority (highest wins):
//   1. Shell env vars               → source: "shell-env"
//   2. ~/.opencode-pilot/config.json (via SettingsStore) → source: "settings-store"
//   3. .env file values             → source: "env-file"
//   4. Hardcoded defaults           → source: "default"
//
// .env values are merged into process.env *without overriding* shell vars
// (see util/dotenv.ts). That leaves us with "env-file or shell-env" keys
// in process.env, so config resolution passes the original shell snapshot
// separately (`shellEnv`) to distinguish the two.

import { DEFAULT_CODEX_PERMISSION_TIMEOUT_MS, DEFAULT_HOST, DEFAULT_PERMISSION_TIMEOUT_MS, DEFAULT_PORT, DEFAULT_PROJECT_STATE_MODE, MAX_CODEX_PERMISSION_TIMEOUT_MS, VAPID_DEFAULT_SUBJECT } from "./constants"
import type { PilotSettings } from "../core/settings/store"
import type { ProjectStateMode } from "../core/state/store"

export type TunnelProvider = "off" | "cloudflared" | "ngrok"
export type { ProjectStateMode }

export interface TelegramConfig {
  token: string
  chatId: string
}

export interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export interface Config {
  port: number
  host: string
  permissionTimeoutMs: number
  tunnel: TunnelProvider
  telegram: TelegramConfig | null
  /** When true, dashboard HTML is re-read from disk on each request (dev mode). */
  dev: boolean
  /** Web Push VAPID config — only set when BOTH keys are present. */
  vapid: VapidConfig | null
  /** Opt-in flag for the glob file opener endpoints. Disabled by default. */
  enableGlobOpener: boolean
  /** Timeout (ms) for outbound HTTP calls (Telegram, push). */
  fetchTimeoutMs: number
  /** Controls when per-project files are written to `<directory>/.opencode/`.
   *  Defaults to `"auto"` (write only when `.opencode/` already exists). */
  projectStateMode: ProjectStateMode
  /** Optional separate token accepted on POST /codex/hooks/* endpoints.
   *  When set, requests on that path can use EITHER this token OR the main
   *  dashboard token. Undefined means fall back to main token only. */
  hookToken?: string
  /** Timeout (ms) for Codex permission requests via the hook bridge.
   *  Defaults to permissionTimeoutMs, falls back to DEFAULT_CODEX_PERMISSION_TIMEOUT_MS. */
  codexPermissionTimeoutMs: number
}

export type ConfigSource = "default" | "env-file" | "settings-store" | "shell-env"

/**
 * Provenance map: for each UI-editable setting, where did its effective value
 * come from? Used by the Settings UI to badge inputs and disable fields whose
 * values come from shell-env (since those cannot be overridden by the store).
 */
export type ConfigSources = Record<keyof PilotSettings, ConfigSource>

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

function parseProjectStateMode(raw: string | undefined): ProjectStateMode {
  if (!raw) return DEFAULT_PROJECT_STATE_MODE
  if (raw === "off" || raw === "auto" || raw === "always") return raw
  throw new ConfigError(
    `Invalid PILOT_PROJECT_STATE value "${raw}". Must be one of: off, auto, always`,
  )
}

// ─── Mapping: env var name ↔ PilotSettings key ───────────────────────────────
// Used to both (a) detect whether a value came from the shell-env and (b)
// translate stored settings into the env-var shape that loadConfig understands.

const ENV_KEY_MAP: Record<keyof PilotSettings, string> = {
  port: "PILOT_PORT",
  host: "PILOT_HOST",
  permissionTimeoutMs: "PILOT_PERMISSION_TIMEOUT",
  tunnel: "PILOT_TUNNEL",
  telegramToken: "PILOT_TELEGRAM_TOKEN",
  telegramChatId: "PILOT_TELEGRAM_CHAT_ID",
  vapidPublicKey: "PILOT_VAPID_PUBLIC_KEY",
  vapidPrivateKey: "PILOT_VAPID_PRIVATE_KEY",
  vapidSubject: "PILOT_VAPID_SUBJECT",
  enableGlobOpener: "PILOT_ENABLE_GLOB_OPENER",
  fetchTimeoutMs: "PILOT_FETCH_TIMEOUT_MS",
  projectStateMode: "PILOT_PROJECT_STATE",
  hookToken: "PILOT_HOOK_TOKEN",
}

export function envKeyFor(field: keyof PilotSettings): string {
  return ENV_KEY_MAP[field]
}

/**
 * Serialize a PilotSettings value into the string form expected by env-var
 * parsing. Kept in sync with loadConfig() parsing logic.
 */
function stringifySetting<K extends keyof PilotSettings>(
  key: K,
  value: NonNullable<PilotSettings[K]>,
): string {
  if (typeof value === "boolean") return value ? "true" : "false"
  return String(value)
}

/**
 * Merge stored settings into an env-like object, without overriding keys that
 * were already set in `shellEnv` (those always win). Returns a NEW object.
 */
export function mergeStoredSettings(
  baseEnv: NodeJS.ProcessEnv,
  shellEnv: NodeJS.ProcessEnv,
  stored: PilotSettings,
): NodeJS.ProcessEnv {
  const out = { ...baseEnv }
  for (const key of Object.keys(ENV_KEY_MAP) as Array<keyof PilotSettings>) {
    const envKey = ENV_KEY_MAP[key]
    const storedValue = stored[key]
    if (storedValue === undefined || storedValue === null) continue
    if (shellEnv[envKey] !== undefined && shellEnv[envKey] !== "") continue
    out[envKey] = stringifySetting(key, storedValue as NonNullable<PilotSettings[typeof key]>)
  }
  return out
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

  const vapid: VapidConfig | null =
    env.PILOT_VAPID_PUBLIC_KEY && env.PILOT_VAPID_PRIVATE_KEY
      ? {
          publicKey: env.PILOT_VAPID_PUBLIC_KEY,
          privateKey: env.PILOT_VAPID_PRIVATE_KEY,
          subject: env.PILOT_VAPID_SUBJECT ?? VAPID_DEFAULT_SUBJECT,
        }
      : null

  const enableGlobOpener = env.PILOT_ENABLE_GLOB_OPENER === "true"
  const fetchTimeoutMs = parseIntOrDefault(env.PILOT_FETCH_TIMEOUT_MS, 10_000)
  const projectStateMode = parseProjectStateMode(env.PILOT_PROJECT_STATE)

  // hookToken — optional separate token for /codex/hooks/* endpoints
  const hookToken = env.PILOT_HOOK_TOKEN && env.PILOT_HOOK_TOKEN.length > 0
    ? env.PILOT_HOOK_TOKEN
    : undefined

  // codexPermissionTimeoutMs — with fallback chain:
  //   PILOT_CODEX_PERMISSION_TIMEOUT_MS → PILOT_PERMISSION_TIMEOUT → DEFAULT
  let codexPermissionTimeoutMs: number
  if (env.PILOT_CODEX_PERMISSION_TIMEOUT_MS !== undefined && env.PILOT_CODEX_PERMISSION_TIMEOUT_MS !== "") {
    const raw = env.PILOT_CODEX_PERMISSION_TIMEOUT_MS
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0) {
      throw new ConfigError(
        `Invalid PILOT_CODEX_PERMISSION_TIMEOUT_MS: "${raw}". Must be a positive integer (milliseconds).`,
      )
    }
    if (n > MAX_CODEX_PERMISSION_TIMEOUT_MS) {
      throw new ConfigError(
        `PILOT_CODEX_PERMISSION_TIMEOUT_MS must be ≤ ${MAX_CODEX_PERMISSION_TIMEOUT_MS}ms (Bun's idle timeout cap is 255s; longer values would cause Codex to see a connection drop instead of a structured deny response).`,
      )
    }
    codexPermissionTimeoutMs = n
  } else {
    // Fall back to permissionTimeoutMs if PILOT_PERMISSION_TIMEOUT was set, else default.
    // Cap at MAX_CODEX_PERMISSION_TIMEOUT_MS so the fallback can never exceed the Bun limit.
    const fallback = permissionTimeoutMs !== DEFAULT_PERMISSION_TIMEOUT_MS
      ? permissionTimeoutMs
      : DEFAULT_CODEX_PERMISSION_TIMEOUT_MS
    codexPermissionTimeoutMs = Math.min(fallback, MAX_CODEX_PERMISSION_TIMEOUT_MS)
  }

  return {
    port,
    host,
    permissionTimeoutMs,
    tunnel,
    telegram,
    dev,
    vapid,
    enableGlobOpener,
    fetchTimeoutMs,
    projectStateMode,
    hookToken,
    codexPermissionTimeoutMs,
  }
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

// ─── Source resolution ──────────────────────────────────────────────────────

/**
 * Compute the provenance of each UI-editable setting.
 *
 * Inputs:
 *   - `shellEnv`: snapshot of env BEFORE dotenv + settings-store were applied.
 *     A key present here means the user exported it in their shell.
 *   - `envFileApplied`: list of env vars written by .env (loadDotEnv.applied).
 *   - `stored`: current SettingsStore content.
 *
 * Anything not from shell-env, env-file, or settings-store is classified as
 * "default" (the value from constants.ts / loadConfig).
 */
export function resolveSources(
  shellEnv: NodeJS.ProcessEnv,
  envFileApplied: string[],
  stored: PilotSettings,
): ConfigSources {
  const out = {} as ConfigSources
  const envFileSet = new Set(envFileApplied)
  for (const key of Object.keys(ENV_KEY_MAP) as Array<keyof PilotSettings>) {
    const envKey = ENV_KEY_MAP[key]
    if (shellEnv[envKey] !== undefined && shellEnv[envKey] !== "") {
      out[key] = "shell-env"
    } else if (stored[key] !== undefined && stored[key] !== null) {
      out[key] = "settings-store"
    } else if (envFileSet.has(envKey)) {
      out[key] = "env-file"
    } else {
      out[key] = "default"
    }
  }
  return out
}

/**
 * Project the effective Config down to the PilotSettings shape the UI expects.
 * Used by GET /settings so the client can display a single structured object.
 */
export function projectConfigToSettings(config: Config): Omit<Required<PilotSettings>, "hookToken"> & { hookTokenConfigured: boolean } {
  return {
    port: config.port,
    host: config.host,
    permissionTimeoutMs: config.permissionTimeoutMs,
    tunnel: config.tunnel,
    telegramToken: config.telegram?.token ?? "",
    telegramChatId: config.telegram?.chatId ?? "",
    vapidPublicKey: config.vapid?.publicKey ?? "",
    vapidPrivateKey: config.vapid?.privateKey ?? "",
    vapidSubject: config.vapid?.subject ?? "",
    enableGlobOpener: config.enableGlobOpener,
    fetchTimeoutMs: config.fetchTimeoutMs,
    projectStateMode: config.projectStateMode,
    // hookToken is intentionally omitted — raw token must never leave this module
    hookTokenConfigured: Boolean(config.hookToken && config.hookToken.length > 0),
  }
}

/** Settings that cannot be applied at runtime — require plugin restart. */
export const RESTART_REQUIRED_FIELDS: ReadonlyArray<keyof PilotSettings> = [
  "port",
  "host",
  "tunnel",
  "vapidPublicKey",
  "vapidPrivateKey",
  "vapidSubject",
  "enableGlobOpener",
]
