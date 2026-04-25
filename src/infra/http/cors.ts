// ─── CORS headers ──────────────────────────────────────────────────────────────
// Pure CORS constants and preflight helper.
// Lives in infra/ so both transport/ and integrations/ can import without
// violating the sibling cross-import rule.
//
// Re-exported from transport/http/middlewares/cors.ts so existing transport
// imports still resolve without changes.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
