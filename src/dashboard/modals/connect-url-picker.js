// connect-url-picker.js — Pure URL selection logic for the connect modal.
// Kept in its own module so it can be unit-tested without the browser DOM.

/**
 * Return the best URL to show as the primary QR code target for mobile access.
 * Priority: tunnel (when available) → LAN (when available) → null.
 * Localhost is NEVER returned — phones cannot reach 127.0.0.1.
 *
 * @param {object|null|undefined} info - Response body from /connect-info
 * @returns {string|null}
 */
export function pickBestUrlForMobile(info) {
  if (!info) return null
  if (info.tunnel?.available && info.tunnel?.url) return info.tunnel.url
  if (info.lan?.available && info.lan?.url) return info.lan.url
  return null
}
