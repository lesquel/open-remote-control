// url-builder.ts — Pure helper for constructing dashboard URLs.
// Extracted so the URL logic is testable without spawning a browser process.

/**
 * Build the final URL to open in the browser for the dashboard.
 *
 * Appends a `#dir=<encoded>` hash fragment carrying the current working
 * directory so the dashboard can auto-focus (or create) the matching project
 * tab on boot.
 *
 * Why a hash fragment instead of a query param?
 * - Hash fragments are client-only: they are not sent to the server and
 *   survive HTTP redirects without being stripped.
 * - Tunnel providers (cloudflared, ngrok) sometimes mangle or log query
 *   strings; hash fragments are opaque to them.
 * - Adding a query param creates a browser history entry; a hash change does
 *   not, keeping the back-button behaviour clean.
 *
 * @param baseUrl  The URL as constructed by the TUI (includes ?token=...).
 * @param cwd      The working directory to encode — typically process.cwd().
 * @returns        The final URL string with `#dir=<encoded>` appended,
 *                 or `baseUrl` unchanged if `cwd` is empty/whitespace.
 */
export function buildDashboardUrl(baseUrl: string, cwd: string): string {
  const trimmed = cwd.trim()
  if (!trimmed) return baseUrl

  // Strip any existing hash from the base URL before appending our own so we
  // never produce a URL with two # characters.
  const hashIndex = baseUrl.indexOf("#")
  const base = hashIndex === -1 ? baseUrl : baseUrl.slice(0, hashIndex)

  return `${base}#dir=${encodeURIComponent(trimmed)}`
}
