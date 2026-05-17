// Type declarations for permission-normalize.js — consumed by .test.ts files.
// The module is browser vanilla JS; this .d.ts gives TypeScript visibility
// without forcing a build step.

export type NormalizedPermissionPending = {
  id: string | undefined
  permissionID: string | undefined
  description: string | undefined
  title: string | undefined
  sessionID: string | undefined
  type: string | undefined
  pattern: string | undefined
  metadata: Record<string, unknown> | undefined
}

export type NormalizedPermissionResolved = {
  id: string | undefined
  permissionID: string | undefined
}

export declare function normalizePermissionPending(ev: Record<string, unknown>): NormalizedPermissionPending
export declare function normalizePermissionResolved(ev: Record<string, unknown>): NormalizedPermissionResolved
