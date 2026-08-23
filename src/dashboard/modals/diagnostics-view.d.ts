export interface DiagnosticsClientState {
  connected?: boolean
  integrations?: Array<{
    id: string
    displayName: string
    capabilities: Record<string, boolean>
  }>
}

export function renderDiagnostics(snapshot: Record<string, unknown>, client?: DiagnosticsClientState): string
export function diagnosticsCopyPayload(snapshot: Record<string, unknown>, client?: DiagnosticsClientState): string
