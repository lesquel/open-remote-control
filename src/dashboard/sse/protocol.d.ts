export const DASHBOARD_SSE_PROTOCOL_VERSION: number
export type ProtocolCompatibility = 'compatible' | 'incompatible' | 'unknown'
export function classifySseProtocol(serverVersion: unknown): ProtocolCompatibility
