// ─── OpenCode agent integration ───────────────────────────────────────────────
// Wires the OpenCode SDK hooks (event, permission.ask, tool.execute.*) through
// the NotificationService and PermissionQueue.
//
// SDK injection-shape spike result (Commit 3):
//   The OpenCode SDK Plugin type is:
//     (input: PluginInput, options?) => Promise<Hooks>
//   PluginInput has NO registerHook() method — there is no imperative hook
//   registration API. Instead, the plugin returns a Hooks object from the
//   server() function, and each property of Hooks is a hook handler.
//
//   Therefore opencodeIntegration.setup() RETURNS the hooks (plus shutdown),
//   and src/server/index.ts (the composition root) spreads them into the
//   Plugin's return value. The registerHook? dep in IntegrationDeps is
//   never passed to this integration; it exists only for future integrations
//   that embed an imperative SDK registration API.

import type { IntegrationHandle } from '../ports'
import type { NotificationService } from '../../notifications/pipeline'
import type { PermissionQueue } from '../../core/permissions/queue'
import type { AuditLog } from '../../core/audit/log'
import type { PluginInput } from '@opencode-ai/plugin'
import type { Permission } from '@opencode-ai/sdk'
import {
  createEventHook,
  createPermissionAskHook,
  createToolHooks,
} from './hooks'

export type OpenCodeHooks = {
  event: ReturnType<typeof createEventHook>
  'permission.ask': (
    input: Permission,
    output: { status?: 'allow' | 'deny' | 'ask' },
  ) => Promise<void>
  'tool.execute.before': (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
  'tool.execute.after': (
    input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
    output: { title: string },
  ) => Promise<void>
}

export type OpenCodeIntegrationHandle = IntegrationHandle & {
  readonly hooks: OpenCodeHooks
  /**
   * Role-aware wrapper for permission.ask.
   * Passive instances skip the blocking waitForResponse so they do not hang.
   * Returns the same hooks but with permission.ask wrapped with a role check.
   */
  readonly withRoleGating: (
    getRole: () => 'primary' | 'passive',
  ) => OpenCodeHooks
}

export type OpenCodeSetupDeps = {
  notifications: NotificationService
  sessionBusyStart: Map<string, number>
  client: PluginInput['client']
  permissions: PermissionQueue
  audit: AuditLog
}

export const opencodeIntegration = {
  name: 'opencode' as const,

  setup(deps: OpenCodeSetupDeps): OpenCodeIntegrationHandle {
    const { notifications, sessionBusyStart, client, permissions, audit } = deps

    const eventHook = createEventHook(
      notifications,
      sessionBusyStart,
      client,
      audit,
    )

    const permissionAskHook = createPermissionAskHook(
      notifications,
      permissions,
      audit,
    )

    const toolHooks = createToolHooks(notifications)

    const hooks: OpenCodeHooks = {
      event: eventHook,
      'permission.ask': permissionAskHook,
      'tool.execute.before': async (
        input: { tool: string; sessionID: string; callID: string },
        output: { args: Record<string, unknown> },
      ) => toolHooks.handleToolBefore(input, { args: output?.args ?? {} }),
      'tool.execute.after': async (
        input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
        output: { title: string },
      ) => toolHooks.handleToolAfter(input, output),
    }

    function withRoleGating(getRole: () => 'primary' | 'passive'): OpenCodeHooks {
      return {
        ...hooks,
        'permission.ask': async (
          input: Permission,
          output: { status?: 'allow' | 'deny' | 'ask' },
        ) => {
          if (getRole() === 'passive') return
          return permissionAskHook(input, output)
        },
      }
    }

    return {
      hooks,
      withRoleGating,
      shutdown: async () => {
        // OpenCode hooks are stateless — nothing to tear down
      },
    }
  },
}
