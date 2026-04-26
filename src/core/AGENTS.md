# core

**Purpose:** Pure domain rules — permissions, events, audit, settings, and state — with no HTTP, Telegram, or Codex code anywhere in this folder.

## Imports (dependency rule)
- May import from: `infra/` (paths, logger)
- May NOT import from: `transport/`, `integrations/`, `notifications/`, `server/`

## Public API (what other modules consume from here)
- `createPermissionQueue(): PermissionQueue` — manages pending permission requests with timeouts
- `getSharedEventBus() / createEventBus(): EventBus` — in-process SSE fan-out bus
- `createAuditLog(): AuditLog` — appends JSON-Lines audit records to `.opencode/pilot-audit.log`
- `rotateIfNeeded()` — rotates the audit log file when it exceeds the size limit
- `createSettingsStore(): SettingsStore` — reads/writes `~/.opencode-pilot/config.json`
- `writeState / clearState / updateStateToken / globalStatePath` — pilot-state.json lifecycle
- `PilotError` — base error class for the whole project
- `interface NotificationService` — (`types/notification-service.ts`) consumed by integrations
- `type PilotEvent / BusEvent` — discriminated union of all pilot events

All of the above re-exported from `core/index.ts`.

## Key files
- `index.ts` — barrel; the only file other modules should import from
- `permissions/queue.ts` — `createPermissionQueue`; manages pending approvals
- `events/bus.ts` — `getSharedEventBus`; singleton EventEmitter wrapper
- `events/types.ts` — `PilotEvent` discriminated union (all event shapes)
- `audit/log.ts` — `createAuditLog`; append-only audit trail
- `audit/rotation.ts` — size-based log rotation
- `settings/store.ts` — `createSettingsStore`; atomic JSON writes with chmod
- `state/store.ts` — `writeState/clearState`; pilot-state.json + project-state logic
- `errors.ts` — `PilotError` base class
- `strings.ts` — `MSG` dictionary (all user-facing strings live here)
- `types/config.ts` — `Config`, `TelegramConfig`, `VapidConfig`, `SettingsSnapshot`, `SettingsLoaderHelper`, `ConfigSources`, `ConfigSource` (canonical location — re-exported by `server/config`)
- `types/notification-service.ts` — `NotificationService` interface (consumed by integrations)
- `types/notification-channels.ts` — `TelegramChannel`, `PushService`, `PushSubscriptionJson`

## Conventions specific to this folder
- Factory functions only (`create*`). No classes.
- All public factories return typed interfaces, not concrete implementations.
- `strings.ts` is the single source for user-facing text — no inline string literals in logic files.

## DO NOT
- Add HTTP, Telegram API calls, or Codex protocol code here.
- Import from `transport/`, `notifications/`, `integrations/`, or `server/`.
- Throw plain `Error`s — extend `PilotError` or use `ConfigError`.

## See also
- `docs/ARCHITECTURE.md` — overall architecture and dependency rule
- `src/infra/AGENTS.md` — the only module `core/` may import from
- `src/notifications/AGENTS.md` — consumes `NotificationService` from `core/types/`
