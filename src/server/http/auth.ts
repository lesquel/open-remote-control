import { timingSafeEqual } from "node:crypto"

function safeEqual(actual: string, expected: string): boolean {
  // Pad both to a common length so timing depends only on the comparison,
  // not on which input was shorter. We always call timingSafeEqual regardless
  // of length so no length information leaks via timing.
  const len = Math.max(actual.length, expected.length, 64)
  const a = Buffer.alloc(len)
  const b = Buffer.alloc(len)
  Buffer.from(actual, "utf8").copy(a)
  Buffer.from(expected, "utf8").copy(b)
  const equalBytes = timingSafeEqual(a, b)
  // AND with length-equality AFTER the constant-time compare so the length
  // check is never observable as a network-timing signal.
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
