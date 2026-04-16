export function validateToken(request: Request, expectedToken: string): boolean {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return false

  const [scheme, token] = authHeader.split(" ")
  if (scheme !== "Bearer") return false

  return token === expectedToken
}

export function getIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown"
  )
}
