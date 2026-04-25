// ─── HTTP JSON helpers ─────────────────────────────────────────────────────────
// Pure HTTP utilities for JSON responses.
// Lives in infra/ so both transport/ and integrations/ can import without
// violating the sibling cross-import rule.
//
// Re-exported from transport/http/middlewares/json.ts so existing transport
// imports still resolve without changes.

export interface ErrorBody {
  error: {
    code: string
    message: string
  }
}

/** Typed JSON response helper. */
export function json<T>(
  data: T,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  })
}

/** Convenience for error responses. */
export function jsonError(
  code: string,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ErrorBody = { error: { code, message } }
  return json(body, status, extraHeaders)
}
