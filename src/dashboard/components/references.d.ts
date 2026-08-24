export type ReferenceAgent = { name?: string } & Record<string, unknown>

export function refresh(): Promise<boolean>
export function getAgents(): ReferenceAgent[]
export function getCurrentProject(): Record<string, unknown> | null
