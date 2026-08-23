# Add a notification channel

Implement `NotificationChannel` inside `src/notifications/channels/<name>/`, then inject it into the local notification pipeline. Channels are adapters: they may deliver events, but they do not own session or permission state.

## Quick path

1. Create `src/notifications/channels/<name>/index.ts` and colocated tests.
2. Return a factory-created `NotificationChannel` from `src/notifications/ports.ts`.
3. Parse channel configuration through the existing central config model; never read arbitrary environment variables inside the channel.
4. Construct the channel in `src/server/index.ts` and pass it through `channels` to `createNotificationService()`.
5. Document exactly which data leaves the machine in `docs/PRIVACY.md` and `docs/CONFIGURATION.md`.

## Minimal contract

```ts
export function createExampleChannel(config: ExampleConfig): NotificationChannel {
  return {
    name: "example",
    enabled: () => config.enabled,
    async send(event) {
      try {
        await deliver(mapEvent(event))
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: safeErrorMessage(error),
          retriable: isTransient(error),
        }
      }
    },
  }
}
```

The generic pipeline currently dispatches `permission.pending`, `session.idle`, and `session.error`. The port also reserves `permission.resolved` and `tool.completed`, but a channel must not assume those events are emitted until the pipeline is extended and tested.

## Delivery rules

| Concern | Requirement |
|---|---|
| Secrets | Store owner-private, redact from logs and API responses, never echo after save |
| Payloads | Send the minimum useful summary; no prompts, source, full commands, or raw tool output by default |
| Failures | Isolate them from other channels and return a typed `NotificationResult` |
| Retries | Bound attempts and use backoff; never block the event bus |
| Shutdown | Let `NotificationService.flush()` drain bounded in-flight sends |
| Deduplication | Use stable local event identity when retries or provider semantics can duplicate delivery |
| URLs | Validate destinations and prevent SSRF for user-configurable endpoints |

Telegram and Web Push expose richer first-party APIs in addition to the generic port. Do not copy those special cases unless the new product behavior genuinely needs them.

## Test checklist

- [ ] Disabled channels perform no network work.
- [ ] Success, permanent failure, and transient failure return the correct result.
- [ ] One failing channel does not block another.
- [ ] Logs and audit records contain no credentials or sensitive payloads.
- [ ] Timeouts, shutdown, and provider rate limits are bounded.
- [ ] Configuration rejects invalid destinations before saving.
- [ ] Privacy and configuration docs match the actual payload.
- [ ] Run `bun scripts/prepublish-guard.ts`, `tsc --noEmit`, and `bun test`.

See [`PRIVACY.md`](./PRIVACY.md) for disclosure requirements and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the port boundary.
