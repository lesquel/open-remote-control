# notifications

**Purpose:** Fan-out for outbound notifications — listens to the event bus and dispatches to all enabled channels in parallel.

## Imports (dependency rule)
- May import from: `core/`, `infra/`
- May NOT import from: `transport/`, `integrations/`, `server/`
- `Config` type comes from `core/types/config` — NOT from `server/config`
- `TELEGRAM_ERROR_MAX_CHARS` lives in `channels/telegram/constants.ts` — NOT in `server/constants`

## Public API (what other modules consume from here)
- `createNotificationService(channels, ...): NotificationService` — (`pipeline.ts`) the fan-out orchestrator
- `createTelegramChannel(config, ...): TelegramChannel` — re-exported from `pipeline.ts`
- `createPushService(deps): PushService` — (`channels/push/service.ts`) VAPID + subscription + channel
- `interface NotificationChannel` — (`ports.ts`) the extension point for new channels
- `type NotificationEvent / NotificationResult` — (`ports.ts`)
- `type PushService / PushSubscriptionJson / TelegramChannel` — re-exported from `pipeline.ts`

## Key files
- `ports.ts` — `NotificationChannel`, `NotificationEvent`, `NotificationResult`
- `pipeline.ts` — `createNotificationService`; subscribes to EventBus and calls `channel.send()` for each enabled channel; also the barrel for public types
- `channels/telegram/index.ts` — `createTelegramChannel`; circuit-breaker wrapped Telegram Bot API
- `channels/telegram/constants.ts` — `TELEGRAM_ERROR_MAX_CHARS` (telegram-specific limit)
- `channels/push/service.ts` — `createPushService`; returns `{ channel, generateVapid, addSubscription, ... }`
- `channels/push/vapid.ts` — VAPID key generation and persistence
- `channels/push/subscriptions.ts` — in-memory + persisted subscription store
- `channels/push/types.ts` — `PushSubscriptionJson`, `PushPayload`, etc.

## Conventions specific to this folder
- Adding a new channel = one new folder under `channels/<name>/` + one line in `server/index.ts`.
- `channel.enabled()` is a function, not a property, so runtime config changes take effect without restart.
- `createPushService()` returns a richer object than a plain `NotificationChannel`. The composition root extracts `push.channel` for the pipeline and passes the full service to `transport/` via `RouteDeps`.

## DO NOT
- Have `pipeline.ts` import directly from `transport/` — VAPID generation reaches the HTTP handler via composition root injection, not a direct import.
- Let channels import from sibling channels.

## See also
- `docs/ARCHITECTURE.md` — NotificationChannel port and Web Push subsystem design
- `src/core/AGENTS.md` — `NotificationService` interface consumed by integrations lives in `core/types/`
