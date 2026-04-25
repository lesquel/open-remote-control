// ─── Integration port ─────────────────────────────────────────────────────────
// The contract honored by every external agent integration (OpenCode native
// hooks, Codex HTTP bridge, and any future integration — Cursor, Aider).
//
// `AgentIntegration` is one of two explicit ports in the architecture. See
// docs/REFACTOR-2026-04-architecture.md §Ports for design rationale.

import type { PermissionQueue } from '../core/permissions/queue'
import type { EventBus } from '../core/events/bus'
import type { AuditLog } from '../core/audit/log'

export interface AgentIntegration {
  readonly name: string
  readonly setup: (deps: IntegrationDeps) => IntegrationHandle
}

export type RouteSpec = {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH'
  pattern: RegExp
  auth: 'required' | 'optional' | 'none'
  handler: (ctx: import('../server/http/routes').RouteContext) => Promise<Response>
}

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
