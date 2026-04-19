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
