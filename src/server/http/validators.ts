// validators.ts — Endpoint-specific body validators.
// Manual type-guard functions; no external deps.
// Each returns { ok: true; data } or { ok: false; error: string }.
//
// Used by handlers.ts for structured request validation.
// On failure, handlers return 400 with { error: "validation failed", detail }.

// ─── POST /sessions ──────────────────────────────────────────────────────────

export interface CreateSessionBody {
  title?: string
}

export function validateCreateSession(
  body: unknown,
): { ok: true; data: CreateSessionBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  if (b.title !== undefined) {
    if (typeof b.title !== "string") {
      return { ok: false, error: "title must be a string" }
    }
    if (b.title.length > 200) {
      return { ok: false, error: "title must be 200 characters or fewer" }
    }
  }
  return { ok: true, data: { title: b.title as string | undefined } }
}

// ─── PATCH /sessions/:id ─────────────────────────────────────────────────────

export interface UpdateSessionBody {
  title: string
}

export function validateUpdateSession(
  body: unknown,
): { ok: true; data: UpdateSessionBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.title !== "string") {
    return { ok: false, error: "title is required and must be a string" }
  }
  if (b.title.trim().length === 0) {
    return { ok: false, error: "title must not be empty" }
  }
  if (b.title.length > 200) {
    return { ok: false, error: "title must be 200 characters or fewer" }
  }
  return { ok: true, data: { title: b.title } }
}

// ─── POST /sessions/:id/prompt ───────────────────────────────────────────────

export interface PromptModel {
  providerID: string
  modelID: string
}

export interface PromptBody {
  message?: string
  parts?: Array<{ type: string; text?: string; [key: string]: unknown }>
  model?: PromptModel
  agent?: string
}

export function validatePromptBody(
  body: unknown,
): { ok: true; data: PromptBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>

  // At least message or non-empty parts is required
  const hasMessage = typeof b.message === "string" && b.message.length > 0
  const hasParts = Array.isArray(b.parts) && b.parts.length > 0
  if (!hasMessage && !hasParts) {
    return { ok: false, error: "message or parts is required" }
  }

  if (typeof b.message === "string") {
    if (b.message.length === 0) {
      return { ok: false, error: "message must not be empty" }
    }
    if (b.message.length > 50_000) {
      return { ok: false, error: "message must be 50000 characters or fewer" }
    }
  }

  if (b.model !== undefined) {
    if (b.model === null || typeof b.model !== "object" || Array.isArray(b.model)) {
      return { ok: false, error: "model must be an object with providerID and modelID" }
    }
    const m = b.model as Record<string, unknown>
    if (typeof m.providerID !== "string" || typeof m.modelID !== "string") {
      return { ok: false, error: "model.providerID and model.modelID must be strings" }
    }
  }

  if (b.agent !== undefined && typeof b.agent !== "string") {
    return { ok: false, error: "agent must be a string" }
  }

  return {
    ok: true,
    data: {
      message: b.message as string | undefined,
      parts: b.parts as PromptBody["parts"],
      model: b.model as PromptModel | undefined,
      agent: b.agent as string | undefined,
    },
  }
}

// ─── POST /push/subscribe ────────────────────────────────────────────────────

export interface PushSubscribeBody {
  endpoint: string
  keys: { auth: string; p256dh: string }
}

export function validatePushSubscribe(
  body: unknown,
): { ok: true; data: PushSubscribeBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.endpoint !== "string" || b.endpoint.length === 0) {
    return { ok: false, error: "endpoint is required and must be a non-empty string URL" }
  }
  if (!b.endpoint.startsWith("http://") && !b.endpoint.startsWith("https://")) {
    return { ok: false, error: "endpoint must be a valid URL (http/https)" }
  }
  const keys = b.keys
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    return { ok: false, error: "keys is required and must be an object" }
  }
  const k = keys as Record<string, unknown>
  if (typeof k.auth !== "string" || k.auth.length === 0) {
    return { ok: false, error: "keys.auth is required and must be a non-empty string" }
  }
  if (typeof k.p256dh !== "string" || k.p256dh.length === 0) {
    return { ok: false, error: "keys.p256dh is required and must be a non-empty string" }
  }
  return {
    ok: true,
    data: {
      endpoint: b.endpoint,
      keys: { auth: k.auth, p256dh: k.p256dh },
    },
  }
}

// ─── POST /push/test ─────────────────────────────────────────────────────────

export interface PushTestBody {
  title?: string
  body?: string
  endpoint?: string
}

export function validatePushTest(
  body: unknown,
): { ok: true; data: PushTestBody } | { ok: false; error: string } {
  // Empty body is acceptable
  if (body === null || body === undefined || (typeof body === "object" && !Array.isArray(body))) {
    const b = (body ?? {}) as Record<string, unknown>
    if (b.title !== undefined && typeof b.title !== "string") {
      return { ok: false, error: "title must be a string" }
    }
    if (b.body !== undefined && typeof b.body !== "string") {
      return { ok: false, error: "body must be a string" }
    }
    if (b.endpoint !== undefined && typeof b.endpoint !== "string") {
      return { ok: false, error: "endpoint must be a string" }
    }
    return {
      ok: true,
      data: {
        title: b.title as string | undefined,
        body: b.body as string | undefined,
        endpoint: b.endpoint as string | undefined,
      },
    }
  }
  return { ok: false, error: "body must be a JSON object or empty" }
}

// ─── POST /fs/read ───────────────────────────────────────────────────────────

export interface FsReadBody {
  path: string
}

export function validateFsRead(
  body: unknown,
): { ok: true; data: FsReadBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.path !== "string" || b.path.length === 0) {
    return { ok: false, error: "path is required and must be a non-empty string" }
  }
  return { ok: true, data: { path: b.path } }
}

// ─── POST /fs/glob ───────────────────────────────────────────────────────────

export interface FsGlobBody {
  pattern: string
}

export function validateFsGlob(
  body: unknown,
): { ok: true; data: FsGlobBody } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  if (typeof b.pattern !== "string" || b.pattern.length === 0) {
    return { ok: false, error: "pattern is required and must be a non-empty string" }
  }
  return { ok: true, data: { pattern: b.pattern } }
}

// ─── PATCH /settings ─────────────────────────────────────────────────────────
//
// Validates a partial PilotSettings payload. Keeps error messages focused —
// each field has its own failure mode. All fields are optional (patch
// semantics); absent fields are left untouched on the server.

import type { PilotSettings } from "../services/settings-store"
import { LOCALHOST_ADDRESSES } from "../constants"

const VALID_HOSTS = new Set<string>(LOCALHOST_ADDRESSES)
// Loose IPv4 regex — four octets 0-255; good enough to catch typos without
// pretending to handle IPv6 edge cases.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/
const NUMERIC_STRING_RE = /^\d+$/

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0
}

export function validateSettingsPatch(
  body: unknown,
): { ok: true; data: Partial<PilotSettings> } | { ok: false; error: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  const out: Partial<PilotSettings> = {}

  if (b.port !== undefined) {
    if (!isPositiveInt(b.port) || (b.port as number) > 65535) {
      return { ok: false, error: "port must be an integer between 1 and 65535" }
    }
    out.port = b.port as number
  }

  if (b.host !== undefined) {
    if (typeof b.host !== "string" || b.host.length === 0) {
      return { ok: false, error: "host must be a non-empty string" }
    }
    if (!VALID_HOSTS.has(b.host) && !IPV4_RE.test(b.host)) {
      return {
        ok: false,
        error: "host must be 127.0.0.1, 0.0.0.0, localhost, ::1, or a valid IPv4 address",
      }
    }
    out.host = b.host
  }

  if (b.permissionTimeoutMs !== undefined) {
    if (!isPositiveInt(b.permissionTimeoutMs)) {
      return { ok: false, error: "permissionTimeoutMs must be a positive integer" }
    }
    out.permissionTimeoutMs = b.permissionTimeoutMs as number
  }

  if (b.tunnel !== undefined) {
    if (b.tunnel !== "off" && b.tunnel !== "cloudflared" && b.tunnel !== "ngrok") {
      return { ok: false, error: "tunnel must be 'off', 'cloudflared', or 'ngrok'" }
    }
    out.tunnel = b.tunnel
  }

  if (b.telegramToken !== undefined) {
    if (typeof b.telegramToken !== "string") {
      return { ok: false, error: "telegramToken must be a string" }
    }
    out.telegramToken = b.telegramToken
  }

  if (b.telegramChatId !== undefined) {
    if (typeof b.telegramChatId !== "string") {
      return { ok: false, error: "telegramChatId must be a string" }
    }
    if (b.telegramChatId.length > 0 && !NUMERIC_STRING_RE.test(b.telegramChatId)) {
      return { ok: false, error: "telegramChatId must be a numeric string (or empty to unset)" }
    }
    out.telegramChatId = b.telegramChatId
  }

  if (b.vapidPublicKey !== undefined) {
    if (typeof b.vapidPublicKey !== "string") {
      return { ok: false, error: "vapidPublicKey must be a string" }
    }
    out.vapidPublicKey = b.vapidPublicKey
  }

  if (b.vapidPrivateKey !== undefined) {
    if (typeof b.vapidPrivateKey !== "string") {
      return { ok: false, error: "vapidPrivateKey must be a string" }
    }
    out.vapidPrivateKey = b.vapidPrivateKey
  }

  if (b.vapidSubject !== undefined) {
    if (typeof b.vapidSubject !== "string") {
      return { ok: false, error: "vapidSubject must be a string" }
    }
    out.vapidSubject = b.vapidSubject
  }

  if (b.enableGlobOpener !== undefined) {
    if (typeof b.enableGlobOpener !== "boolean") {
      return { ok: false, error: "enableGlobOpener must be a boolean" }
    }
    out.enableGlobOpener = b.enableGlobOpener
  }

  if (b.fetchTimeoutMs !== undefined) {
    if (!isPositiveInt(b.fetchTimeoutMs)) {
      return { ok: false, error: "fetchTimeoutMs must be a positive integer" }
    }
    out.fetchTimeoutMs = b.fetchTimeoutMs as number
  }

  if (b.projectStateMode !== undefined) {
    if (b.projectStateMode !== "off" && b.projectStateMode !== "auto" && b.projectStateMode !== "always") {
      return {
        ok: false,
        error: "projectStateMode must be 'off', 'auto', or 'always'",
      }
    }
    out.projectStateMode = b.projectStateMode
  }

  if (b.hookToken !== undefined) {
    if (b.hookToken === null) {
      // null means "clear the token" — we'll store undefined/remove
      // Pass-through so the handler can clear it; sanitize in store will drop empty strings.
      out.hookToken = "" as string
    } else if (typeof b.hookToken !== "string") {
      return { ok: false, error: "hookToken must be a string or null" }
    } else if (b.hookToken.length === 0) {
      return { ok: false, error: "hookToken must not be empty (use null to clear)" }
    } else {
      out.hookToken = b.hookToken
    }
  }

  return { ok: true, data: out }
}
