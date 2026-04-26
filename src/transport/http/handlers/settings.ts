import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { validatePushSubscribe, validatePushTest, validateSettingsPatch } from "../validators/settings"
import {
  RESTART_REQUIRED_FIELDS,
  envKeyFor,
  loadConfigSafe,
  mergeStoredSettings,
  projectConfigToSettings,
  resolveSources,
} from "../../../server/config"
import { VAPID_DEFAULT_SUBJECT } from "../../../server/constants"
import { MSG } from "../../../core/strings"
import type { PushSubscriptionJson } from "../../../core/types/notification-channels"
import type { PilotSettings } from "../../../core/settings/store"

// ─── Web Push ────────────────────────────────────────────────────────────────

export async function getPushPublicKey({ deps }: RouteContext): Promise<Response> {
  if (!deps.config.vapid) {
    return jsonError(
      "PUSH_DISABLED",
      MSG.WEB_PUSH_NOT_CONFIGURED,
      503,
      CORS_HEADERS,
    )
  }
  return json({ publicKey: deps.config.vapid.publicKey }, 200, CORS_HEADERS)
}

function isValidSubscriptionBody(v: unknown): v is PushSubscriptionJson {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.endpoint !== "string" || o.endpoint.length === 0) return false
  const keys = o.keys
  if (!keys || typeof keys !== "object") return false
  const k = keys as Record<string, unknown>
  return typeof k.p256dh === "string" && typeof k.auth === "string"
}

export async function subscribePush({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.push.isEnabled()) {
    return jsonError("PUSH_DISABLED", "Web Push is not configured", 503, CORS_HEADERS)
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }
  const validation = validatePushSubscribe(body)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "POST /push/subscribe",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }
  if (!isValidSubscriptionBody(body)) {
    return jsonError(
      "INVALID_SUBSCRIPTION",
      "Body must be a PushSubscription JSON with endpoint and keys.{p256dh,auth}",
      400,
      CORS_HEADERS,
    )
  }
  const result = deps.push.addSubscription(body as PushSubscriptionJson)
  if (result.ok === false) {
    return jsonError("INVALID_ENDPOINT", result.reason, 400, CORS_HEADERS)
  }
  return json({ ok: true, count: deps.push.count() }, 200, CORS_HEADERS)
}

interface UnsubscribeBody {
  endpoint?: string
}

export async function unsubscribePush({ req, deps }: RouteContext): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }
  if (!body || typeof body !== "object") {
    return jsonError("INVALID_BODY", "Request body must be a JSON object", 400, CORS_HEADERS)
  }
  const { endpoint } = body as UnsubscribeBody
  if (!endpoint || typeof endpoint !== "string") {
    return jsonError("MISSING_ENDPOINT", "endpoint is required", 400, CORS_HEADERS)
  }
  deps.push.removeSubscription(endpoint)
  return json({ ok: true }, 200, CORS_HEADERS)
}

export async function testPush({ req, deps }: RouteContext): Promise<Response> {
  if (!deps.push.isEnabled()) {
    return jsonError("PUSH_DISABLED", "Web Push is not configured", 503, CORS_HEADERS)
  }
  let rawBody: unknown = {}
  try {
    const raw = await req.text()
    rawBody = raw ? JSON.parse(raw) : {}
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validatePushTest(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "POST /push/test",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  const { endpoint } = validation.data

  const payload = {
    title: "OpenCode Pilot — test push",
    body: "Web Push is working",
    data: { kind: "test", url: "/" },
  }

  if (endpoint) {
    const ok = await deps.push.sendTo(endpoint, payload)
    return json({ ok }, ok ? 200 : 404, CORS_HEADERS)
  }

  await deps.push.broadcast(payload)
  return json({ ok: true, sent: deps.push.count() }, 200, CORS_HEADERS)
}

// ─── Settings API ────────────────────────────────────────────────────────────
//
// Exposes the layered configuration (defaults → .env → settings-store → shell)
// so the dashboard can display and edit it. Writes go to the JSON store; shell
// env vars cannot be overridden from the UI (409 on conflict).
//
// Sensitive fields (telegram token, VAPID private key) are redacted in GET
// responses — the UI only needs to know whether they are configured.

/** Redact a secret field for GET responses. The raw value is never sent. */
function redactSecret(value: string | undefined): { configured: boolean; preview: string } {
  if (!value || value.length === 0) return { configured: false, preview: "" }
  if (value.length <= 8) return { configured: true, preview: "•".repeat(value.length) }
  return { configured: true, preview: `${value.slice(0, 4)}…${value.slice(-4)}` }
}

function buildSettingsResponse(deps: RouteContext["deps"]): {
  settings: ReturnType<typeof projectConfigToSettings>
  sources: ReturnType<typeof resolveSources>
  restartRequired: ReadonlyArray<keyof PilotSettings>
  configFilePath: string
} {
  // Recompute the effective config from the FRESH store + shell env every
  // time. `deps.config` is a boot-time snapshot and does not reflect changes
  // made via PATCH /settings — returning it here caused saved values (port,
  // host, tunnel, etc.) to appear "reverted" in the UI even though the disk
  // state was correct. Settings marked `restartRequired` still need a plugin
  // restart to take effect; `settings` below shows the value that WILL be
  // active after that restart.
  const stored = deps.settingsStore.load()
  const effectiveEnv = mergeStoredSettings(process.env, deps.shellEnv, stored)
  const effective = loadConfigSafe(effectiveEnv, () => {
    // swallow — we already warned once at boot
  })
  return {
    settings: projectConfigToSettings(effective),
    sources: resolveSources(deps.shellEnv, deps.envFileApplied, stored),
    restartRequired: RESTART_REQUIRED_FIELDS,
    configFilePath: deps.settingsStore.filePath(),
  }
}

/**
 * Sanitize a raw settings response, redacting sensitive fields.
 * Used by both GET /settings and PATCH /settings (and any future handler
 * that returns a settings snapshot) so that telegramToken and vapidPrivateKey
 * are never exposed as raw strings. hookToken is already excluded from the
 * settings projection (projectConfigToSettings returns hookTokenConfigured boolean only).
 */
function sanitizeSettingsResponse(result: ReturnType<typeof buildSettingsResponse>) {
  const { telegramToken, vapidPrivateKey, ...otherSettings } = result.settings
  return {
    ...result,
    settings: {
      ...otherSettings,
      telegramToken: redactSecret(telegramToken),
      vapidPrivateKey: redactSecret(vapidPrivateKey),
    },
  }
}

export async function getSettings({ deps }: RouteContext): Promise<Response> {
  const result = buildSettingsResponse(deps)
  return json(sanitizeSettingsResponse(result), 200, CORS_HEADERS)
}

export async function patchSettings({ req, deps }: RouteContext): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonError("INVALID_JSON", "Failed to parse the request body. Try refreshing the dashboard; if it persists, restart OpenCode.", 400, CORS_HEADERS)
  }

  const validation = validateSettingsPatch(rawBody)
  if (!validation.ok) {
    deps.audit.log("validation.failed", {
      endpoint: "PATCH /settings",
      reason: validation.error,
    })
    return jsonError("VALIDATION_FAILED", validation.error, 400, CORS_HEADERS)
  }

  // Reject fields that are pinned by shell-env — we cannot override those.
  const conflicts: string[] = []
  for (const key of Object.keys(validation.data) as Array<keyof PilotSettings>) {
    const envKey = envKeyFor(key)
    if (deps.shellEnv[envKey] !== undefined && deps.shellEnv[envKey] !== "") {
      conflicts.push(key)
    }
  }
  if (conflicts.length > 0) {
    return jsonError(
      "SHELL_ENV_PINNED",
      `Cannot override: ${conflicts.join(", ")} (set via shell env). Unset the env var and retry.`,
      409,
      CORS_HEADERS,
    )
  }

  deps.settingsStore.save(validation.data)
  deps.audit.log("settings.saved", {
    keys: Object.keys(validation.data),
  })

  return json(sanitizeSettingsResponse(buildSettingsResponse(deps)), 200, CORS_HEADERS)
}

export async function resetSettings({ deps }: RouteContext): Promise<Response> {
  deps.settingsStore.reset()
  deps.audit.log("settings.reset", {})
  return json({ ok: true, configFilePath: deps.settingsStore.filePath() }, 200, CORS_HEADERS)
}

/**
 * Generate a fresh VAPID key pair. Does NOT auto-save — the UI shows the keys
 * and lets the user decide. Delegates to deps.push.generateVapid() which
 * wraps the web-push module (no inline web-push loading here).
 */
export async function generateVapidKeys({ deps }: RouteContext): Promise<Response> {
  const result = await deps.push.generateVapid()
  if (!result.ok) {
    deps.logger.error("generateVapidKeys failed", { error: result.error })
    const isNotInstalled = result.error.includes("not installed")
    return jsonError(
      "WEB_PUSH_UNAVAILABLE",
      isNotInstalled ? "web-push module not installed" : result.error,
      isNotInstalled ? 503 : 500,
      CORS_HEADERS,
    )
  }
  deps.audit.log("settings.vapid.generated", {})
  return json(
    {
      publicKey: result.publicKey,
      privateKey: result.privateKey,
      subject: VAPID_DEFAULT_SUBJECT,
    },
    200,
    CORS_HEADERS,
  )
}
