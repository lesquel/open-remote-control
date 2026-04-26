// ─── Config type ──────────────────────────────────────────────────────────────
// The Config interface lives in core/types/ so transport/, integrations/, and
// notifications/ can reference the type without importing from server/ (the
// composition root). The config loader (loadConfigSafe / mergeStoredSettings /
// resolveSources) still lives in server/config.ts — only the TYPE is here.
//
// SettingsLoaderHelper is the injectable surface that lets transport/http/handlers/
// settings.ts rebuild an effective config from the live store without importing
// server/config.ts directly.

import type { TunnelProvider } from "../../infra/tunnel/types"
import type { ProjectStateMode } from "../../infra/paths/index"
import type { PilotSettings } from "../settings/store"

export type { TunnelProvider }
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

/** Source of a config value — tracks provenance for the Settings UI. */
export type ConfigSource = "default" | "env-file" | "settings-store" | "shell-env"

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

// ─── Settings loader helper ───────────────────────────────────────────────────
// Injectable surface that lets transport/http/handlers/settings.ts rebuild an
// effective config from the live store without importing server/config directly.
// The composition root (server/index.ts) provides the implementation.

/** Provenance map: for each UI-editable setting, where did the effective value come from? */
export type ConfigSources = Record<string, ConfigSource>

/** A projected snapshot for the Settings UI (flat, redact-ready shape). */
export type SettingsSnapshot = {
  port: number
  host: string
  permissionTimeoutMs: number
  tunnel: TunnelProvider
  telegramToken: string
  telegramChatId: string
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
  enableGlobOpener: boolean
  fetchTimeoutMs: number
  projectStateMode: ProjectStateMode
  hookTokenConfigured: boolean
}

/**
 * Injected helper that settings handlers use to rebuild the effective config
 * from the live settings store. Keeps server/config.ts logic OUT of transport/.
 */
export interface SettingsLoaderHelper {
  /** Load the effective Config + UI projection + source provenance from the
   *  current store + shell env snapshot. Used by GET/PATCH /settings. */
  loadEffective(stored: PilotSettings): {
    effective: Config
    settings: SettingsSnapshot
    sources: ConfigSources
  }
  /** The env-var key for a given settings field (used by PATCH /settings to
   *  detect shell-env-pinned fields and return 409). */
  envKeyFor(field: string): string
  /** Fields that require a plugin restart to take effect. */
  restartRequiredFields: ReadonlyArray<string>
}
