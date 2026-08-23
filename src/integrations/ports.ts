// ─── Integration port ─────────────────────────────────────────────────────────
// `AgentIntegration` models the HTTP-route-bridged CLI integration contract:
// a `setup(IntegrationDeps)` that registers routes/hooks imperatively and
// returns an `IntegrationHandle`. It is honored by `codexIntegration`
// (integrations/codex/index.ts) and by any future integration that exposes an
// imperative registration API (Cursor, Aider).
//
// It is one of two explicit ports in the architecture. See
// docs/REFACTOR-2026-04-architecture.md §Ports for design rationale.
//
// Intentional outlier — `opencodeIntegration` does NOT implement this port.
// The OpenCode SDK plugin model has no imperative hook-registration API: the
// plugin must RETURN a Hooks object, so `opencodeIntegration.setup()` takes a
// wider `OpenCodeSetupDeps` and returns `OpenCodeIntegrationHandle` (hooks +
// shutdown) instead of conforming to `AgentIntegration`. This is a native-SDK
// integration, not an HTTP-bridged one — forcing it behind this port would
// mean optional deps no other integration uses (a false abstraction). The
// shared seam is `IntegrationHandle` (the shutdown contract), which
// `OpenCodeIntegrationHandle` does extend. Full rationale and the SDK
// injection-shape spike result live in integrations/opencode/index.ts.

import type { PermissionQueue } from '../core/permissions/queue'
import type { EventBus } from '../core/events/bus'
import type { AuditLog } from '../core/audit/log'
import type { Route } from '../infra/http/types'
import { createAgentDescriptor } from '../core/types/agent-integration'
import type { AgentDescriptor } from '../core/types/agent-integration'

export { createAgentDescriptor }
export type { AgentDescriptor, AgentCapabilities } from '../core/types/agent-integration'

export interface AgentIntegration extends AgentDescriptor {
  readonly setup: (deps: IntegrationDeps) => IntegrationHandle
}

export function createAgentIntegration(
  descriptor: AgentDescriptor,
  setup: (deps: IntegrationDeps) => IntegrationHandle,
): AgentIntegration {
  return Object.freeze({ ...createAgentDescriptor(descriptor), setup })
}

// RouteSpec is an alias for the infra Route type. Using `unknown` as TDeps means
// any handler is assignable regardless of its specific deps shape.
export type RouteSpec = Route<unknown>

export type HookFn = (...args: unknown[]) => Promise<unknown>

export type IntegrationDeps = {
  permissions: PermissionQueue
  codexPermissions?: PermissionQueue
  events: EventBus
  audit: AuditLog
  registerRoute?: (route: RouteSpec) => void
  registerHook?: (event: string, handler: HookFn) => void
}

export type IntegrationHandle = {
  readonly shutdown: () => Promise<void>
}
