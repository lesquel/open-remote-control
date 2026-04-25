// ─── HTTP auth utilities ───────────────────────────────────────────────────────
// Pure HTTP utilities for token validation and IP extraction.
// Lives in infra/ so both transport/ and integrations/ can import without
// violating the sibling cross-import rule.
//
// Re-exported from transport/http/middlewares/auth.ts so existing transport
// imports still resolve without changes.

import { timingSafeEqual } from "node:crypto"

function safeEqual(actual: string, expected: string): boolean {
  const len = Math.max(actual.length, expected.length, 64)
  const a = Buffer.alloc(len)
  const b = Buffer.alloc(len)
  Buffer.from(actual, "utf8").copy(a)
  Buffer.from(expected, "utf8").copy(b)
  const equalBytes = timingSafeEqual(a, b)
  return equalBytes && actual.length === expected.length
}

export function validateToken(request: Request, expectedToken: string): boolean {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return false

  const [scheme, token] = authHeader.split(" ")
  if (scheme !== "Bearer") return false
  if (token === undefined) return false

  return safeEqual(token, expectedToken)
}

export { safeEqual }

export function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}

/**
 * Validate a request token for endpoints that accept a secondary hook token.
 * Accepts EITHER the hookToken (if configured and non-empty) OR the main token.
 * When hookToken is unset/empty, falls back to main token only.
 *
 * Lives in infra/ so both integrations/ and transport/ tests can import it
 * without creating a cross-sibling dependency violation.
 */
export function validateHookToken(
  req: Request,
  hookToken: string | undefined,
  mainToken: string,
): boolean {
  if (hookToken && hookToken.length > 0) {
    return validateToken(req, hookToken) || validateToken(req, mainToken)
  }
  return validateToken(req, mainToken)
}
