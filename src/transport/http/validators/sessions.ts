// validators/sessions.ts — Validators for session-related endpoints.

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

  // Validate parts elements: each must be a non-null object with a non-empty string `type`.
  // A malformed element from an untrusted caller could propagate an unusable part
  // shape to the SDK and produce a cryptic downstream error.
  if (Array.isArray(b.parts)) {
    for (let i = 0; i < b.parts.length; i++) {
      const el = b.parts[i]
      if (el === null || typeof el !== "object" || Array.isArray(el)) {
        return { ok: false, error: `parts[${i}]: each part element must be a non-null object` }
      }
      const part = el as Record<string, unknown>
      if (typeof part.type !== "string" || part.type.length === 0) {
        return { ok: false, error: `parts[${i}]: each part element must have a non-empty string "type"` }
      }
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
    // modelID MUST be non-empty — it's the meaningful routing key for the SDK.
    // providerID MAY be empty: the dashboard sends '' when no provider override is
    // selected (sessions.js: opts.providerID = modelPref.providerId ?? ''), so
    // rejecting empty providerID would silently drop legitimate prompts.
    if (m.modelID.length === 0) {
      return { ok: false, error: "model.modelID must not be empty" }
    }
    // Length caps prevent oversized strings from propagating to SSE clients / audit.
    if (m.providerID.length > 200) {
      return { ok: false, error: "model.providerID must be 200 characters or fewer" }
    }
    if (m.modelID.length > 200) {
      return { ok: false, error: "model.modelID must be 200 characters or fewer" }
    }
  }

  if (b.agent !== undefined && typeof b.agent !== "string") {
    return { ok: false, error: "agent must be a string" }
  }
  // Cap agent length for the same SSE/audit overflow reason as model fields.
  if (typeof b.agent === "string" && b.agent.length > 200) {
    return { ok: false, error: "agent must be 200 characters or fewer" }
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
