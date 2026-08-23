// ─── Codex agent integration ──────────────────────────────────────────────────
// Wires the Codex CLI hook bridge via HTTP POST /codex/hooks/:event.
// Self-registers the route via registerRoute — the route no longer lives in
// the central routes.ts table (removed in Commit 3).

import { createAgentIntegration, type AgentIntegration, type IntegrationDeps, type IntegrationHandle, type RouteSpec } from '../ports'
import { dispatchCodexHook } from './handlers'

function createCodexIntegration(): AgentIntegration {
  return createAgentIntegration({
    id: 'codex',
    displayName: 'Codex',
    capabilities: {
      sessions: false,
      streaming: false,
      permissions: true,
      tools: true,
      cost: false,
      todos: false,
      files: false,
      models: false,
      agents: false,
    },
  }, (deps: IntegrationDeps): IntegrationHandle => {
      if (deps.registerRoute) {
        const route: RouteSpec = {
          method: 'POST',
          // Codex hook bridge — auth is validated inside dispatchCodexHook
          // (hookToken OR main token). Matches /codex/hooks/SessionStart etc.
          pattern: /^\/codex\/hooks\/(?<event>[A-Za-z]+)$/,
          auth: 'none',
          handler: dispatchCodexHook,
        }
        deps.registerRoute(route)
      }

      return {
        shutdown: async () => {
          // Codex is a stateless HTTP bridge — nothing to tear down
        },
      }
  })
}

export const codexIntegration = createCodexIntegration()
