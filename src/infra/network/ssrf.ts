// ─── SSRF guard ───────────────────────────────────────────────────────────────
// Validates outbound URLs against server-side request forgery vectors.
// Lives in infra/network/ so both notifications/ and transport/ can import
// without violating the sibling cross-import rule.
//
// Originally defined in notifications/channels/push/service.ts; relocated here
// so transport/http/handlers/sessions.ts can apply the same guard to the
// attachment proxy without creating a cross-sibling dependency.

/**
 * Validate an outbound URL against SSRF vectors.
 *
 * Blocks loopback, RFC 1918 private ranges, link-local, and IPv6 private
 * addresses. Requires HTTPS (push subscriptions) — callers that accept http://
 * MUST enforce their own scheme policy.
 *
 * Known residual limitations (string/hostname-based guard, by design):
 *  - No DNS resolution: a public hostname that resolves to a private address
 *    (DNS rebinding) is not detected here.
 *  - No IP-format normalization: alternate encodings (decimal/octal/hex) of an
 *    address are not canonicalized before matching.
 * These are accepted given the trusted-source contexts this guard runs in
 * (SDK-supplied attachment URLs, user push endpoints). Defense-in-depth, not a
 * complete egress firewall.
 *
 * Return contract: `{ ok: true }` | `{ ok: false; reason: string }`.
 */
export function validateEndpoint(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'endpoint must use https:' }
  }
  const host = url.hostname.toLowerCase()
  // Strip IPv6 brackets added by URL parser (e.g. [::1] → ::1)
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  // Loopback / unspecified
  if (
    bare === 'localhost' ||
    bare === '0.0.0.0' ||
    bare === '127.0.0.1' ||
    bare === '::1'
  ) {
    return { ok: false, reason: 'localhost endpoints are not allowed' }
  }
  // RFC 1918 private ranges (IPv4)
  if (/^10\./.test(bare)) return { ok: false, reason: 'private IP range not allowed' }
  if (/^192\.168\./.test(bare)) return { ok: false, reason: 'private IP range not allowed' }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(bare)) return { ok: false, reason: 'private IP range not allowed' }
  // Link-local (IPv4)
  if (/^169\.254\./.test(bare)) return { ok: false, reason: 'link-local address not allowed' }
  // Unique-local / link-local (IPv6)
  if (bare.startsWith('fc') || bare.startsWith('fd') || bare.startsWith('fe80:')) {
    return { ok: false, reason: 'private IPv6 range not allowed' }
  }
  return { ok: true }
}
