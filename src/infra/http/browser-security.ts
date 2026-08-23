import { hostname, networkInterfaces } from "node:os"

export interface BrowserBoundaryOptions {
  host: string
  port: number
  tunnelUrl: string | null
  allowedHosts?: readonly string[]
  allowedOrigins?: readonly string[]
}

export type BrowserBoundaryResult =
  | { ok: true; origin: string | null }
  | { ok: false; code: "INVALID_HOST" | "INVALID_ORIGIN" }

export const BROWSER_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  // The separately-hosted PWA loads authenticated attachment images directly.
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
}

interface Authority {
  hostname: string
  port: string
  serialized: string
}

function normalizeHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
}

function parseAuthority(value: string): Authority | null {
  try {
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    const normalizedHostname = normalizeHostname(url.hostname)
    if (!normalizedHostname) return null
    return {
      hostname: normalizedHostname,
      port: url.port,
      serialized: `${normalizedHostname}${url.port ? `:${url.port}` : ""}`,
    }
  } catch {
    return null
  }
}

function localHostnames(
  configuredHost: string,
  extraAllowedHosts: readonly string[],
): Set<string> {
  const allowed = new Set(["localhost", "127.0.0.1", "::1"])
  const configured = normalizeHostname(configuredHost)
  if (configured !== "0.0.0.0" && configured !== "::" && configured !== "") {
    allowed.add(configured)
  }

  const machineHostname = normalizeHostname(hostname())
  if (machineHostname) {
    allowed.add(machineHostname)
    allowed.add(`${machineHostname}.local`)
  }

  for (const allowedHost of extraAllowedHosts) allowed.add(normalizeHostname(allowedHost))

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) allowed.add(normalizeHostname(address.address))
  }
  return allowed
}

function isAllowedHost(authority: Authority, options: BrowserBoundaryOptions): boolean {
  if (options.tunnelUrl) {
    try {
      const tunnel = new URL(options.tunnelUrl)
      const tunnelAuthority = parseAuthority(tunnel.host)
      if (tunnelAuthority?.serialized === authority.serialized) return true
    } catch {
      // A malformed tunnel URL is ignored; it must never widen the allowlist.
    }
  }

  if (!localHostnames(options.host, options.allowedHosts ?? []).has(authority.hostname)) return false
  return authority.port === "" || authority.port === String(options.port)
}

/**
 * Reject DNS-rebinding hosts and cross-origin browser requests before routing.
 * Non-browser clients such as Codex hooks omit Origin and remain supported.
 */
export function validateBrowserBoundary(
  request: Request,
  options: BrowserBoundaryOptions,
): BrowserBoundaryResult {
  const requestAuthority = parseAuthority(request.headers.get("host") ?? "")
  if (!requestAuthority || !isAllowedHost(requestAuthority, options)) {
    return { ok: false, code: "INVALID_HOST" }
  }

  const origin = request.headers.get("origin")
  if (origin === null) return { ok: true, origin: null }
  if (origin === "null") return { ok: false, code: "INVALID_ORIGIN" }

  try {
    const originUrl = new URL(origin)
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
      return { ok: false, code: "INVALID_ORIGIN" }
    }
    const originAuthority = parseAuthority(originUrl.host)
    const allowedOrigins = new Set(options.allowedOrigins ?? [])
    if (
      !originAuthority ||
      (originAuthority.serialized !== requestAuthority.serialized &&
        !allowedOrigins.has(originUrl.origin))
    ) {
      return { ok: false, code: "INVALID_ORIGIN" }
    }
    return { ok: true, origin: originUrl.origin }
  } catch {
    return { ok: false, code: "INVALID_ORIGIN" }
  }
}

export function applyBrowserResponseHeaders(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(BROWSER_SECURITY_HEADERS)) headers.set(name, value)

  if (origin !== null) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Access-Control-Expose-Headers", "X-Request-ID")
    const vary = headers.get("Vary")
    headers.set("Vary", vary ? `${vary}, Origin` : "Origin")
  } else {
    headers.delete("Access-Control-Allow-Origin")
    headers.delete("Access-Control-Expose-Headers")
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
