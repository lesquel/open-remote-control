export interface DiagnosticsClientState {
  connected?: boolean
}

export function renderDiagnostics(snapshot: Record<string, unknown>, client?: DiagnosticsClientState): string
export function diagnosticsCopyPayload(snapshot: Record<string, unknown>, client?: DiagnosticsClientState): string
