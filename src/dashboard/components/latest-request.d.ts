export interface LatestRequestTicket {
  generation: number
  key: string | null
}

export interface LatestRequestGate {
  begin(key: string | null): LatestRequestTicket
  isCurrent(ticket: LatestRequestTicket): boolean
}

export function createLatestRequestGate(
  getCurrentKey: () => string | null,
): LatestRequestGate
