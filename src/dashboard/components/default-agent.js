// default-agent.js — Pure helper for picking the default agent from /agents.
// No DOM, no globals — import and test freely.

/**
 * Pick the default agent from the list returned by GET /agents.
 *
 * Strategy (priority order):
 * 1. If any agent has `default: true` (future SDK), return it.
 * 2. Otherwise return the first agent in the list (OpenCode's implicit default).
 * 3. Return null when the list is empty or falsy.
 *
 * NOTE: as of the current @opencode-ai/sdk the Agent type has no `default`
 * field — the first entry is the effective default for a fresh session.
 * Step 1 is future-proofing; if upstream adds it we benefit automatically.
 *
 * @param {Array<{name: string, description?: string, color?: string, default?: boolean}>} agents
 * @returns {{ name: string, description?: string, color?: string } | null}
 */
export function pickDefaultAgent(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return null
  const explicit = agents.find(a => a.default === true)
  if (explicit) return explicit
  return agents[0]
}
