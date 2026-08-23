export const DASHBOARD_SSE_PROTOCOL_VERSION = 1

/**
 * Older servers did not advertise a protocol version. Preserve compatibility
 * with them, but fail closed when both peers declare different versions.
 */
export function classifySseProtocol(serverVersion) {
  if (serverVersion === undefined || serverVersion === null) return 'unknown'
  if (!Number.isInteger(serverVersion) || serverVersion < 1) return 'incompatible'
  return serverVersion === DASHBOARD_SSE_PROTOCOL_VERSION
    ? 'compatible'
    : 'incompatible'
}
