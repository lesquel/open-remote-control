// validators/common.ts — Shared/reusable validators.

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
