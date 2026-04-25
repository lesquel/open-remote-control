// ─── Core barrel ──────────────────────────────────────────────────────────────
// Re-exports the public surface of all core modules.
// Used by the composition root (src/server/index.ts) in Commit 6.

export { createEventBus, getSharedEventBus } from "./events/bus"
export type { EventBus } from "./events/bus"

export { createPermissionQueue } from "./permissions/queue"
export type {
  PermissionQueue,
  PendingPermission,
  PermissionMeta,
} from "./permissions/queue"

export { createAuditLog } from "./audit/log"
export type { AuditLog } from "./audit/log"

export { rotateIfNeeded } from "./audit/rotation"

export {
  writeState,
  readState,
  readGlobalState,
  clearState,
  globalStatePath,
  shouldWriteProjectState,
  updateStateToken,
} from "./state/store"
export type {
  PilotState,
  ProjectStateMode,
  WriteStateResult,
  WriteOutcome,
} from "./state/store"

export { createSettingsStore } from "./settings/store"
export type {
  SettingsStore,
  PilotSettings,
  SettingsStoreDeps,
} from "./settings/store"

export { PilotError } from "./errors"

export type {
  PilotEvent,
  BusEvent,
  SdkEvent,
  CodexHookEvent,
  CodexPermissionMode,
  CodexSessionStartPayload,
  CodexUserPromptSubmitPayload,
  CodexPreToolUsePayload,
  CodexPostToolUsePayload,
  CodexPermissionRequestPayload,
  CodexStopPayload,
  CodexHookDecision,
  CodexPermissionResponse,
} from "./events/types"
