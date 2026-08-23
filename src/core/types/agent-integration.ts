export type AgentCapabilities = Readonly<{
  sessions: boolean
  streaming: boolean
  permissions: boolean
  tools: boolean
  cost: boolean
  todos: boolean
  files: boolean
  models: boolean
  agents: boolean
}>

export interface AgentDescriptor {
  /** Stable protocol identifier. Never derive this from the display label. */
  readonly id: string
  readonly displayName: string
  readonly capabilities: AgentCapabilities
}

export function createAgentDescriptor(descriptor: AgentDescriptor): AgentDescriptor {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.id)) {
    throw new PilotError("INVALID_AGENT_INTEGRATION", `Invalid agent integration id: ${descriptor.id}`)
  }
  if (!descriptor.displayName.trim()) {
    throw new PilotError("INVALID_AGENT_INTEGRATION", "Agent integration displayName must not be empty")
  }
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze({ ...descriptor.capabilities }),
  })
}
import { PilotError } from "../errors"
