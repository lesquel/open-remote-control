/** Minimal Agent shape (mirrors @opencode-ai/sdk Agent + optional future `default` flag). */
export type AgentEntry = {
  name: string
  description?: string
  color?: string
  /** Future-proof: SDK may add this; not present today. */
  default?: boolean
}

/**
 * Pick the default agent from the list returned by GET /agents.
 *
 * Returns the first agent marked `default: true` if one exists, otherwise
 * the first element of the list, or `null` when the list is empty/falsy.
 */
export function pickDefaultAgent(agents: AgentEntry[]): AgentEntry | null
