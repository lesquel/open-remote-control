// Type declarations for connect-url-picker.js — kept as .js because the
// dashboard ships .js to the browser. This .d.ts is consumed by the unit
// test (connect-modal.test.ts) and by editors for IntelliSense.

export type ConnectInfoLike = {
  tunnel?: { available?: boolean; url?: string | null } | null
  lan?: { available?: boolean; url?: string | null } | null
} | null | undefined

/**
 * Returns the best URL to show as the primary QR target for mobile access.
 * Priority: tunnel (if available + url) → LAN (if available + url) → null.
 * Localhost is NEVER returned — phones cannot reach 127.0.0.1.
 */
export function pickBestUrlForMobile(info: ConnectInfoLike): string | null
