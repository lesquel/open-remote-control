// ─── Push channel entry point ─────────────────────────────────────────────────
// Thin wrapper that creates the full push subsystem and exposes only the
// NotificationChannel surface to the notification pipeline.
//
// The notification pipeline only needs NotificationChannel — it should not
// know about subscription management or VAPID generation. Those are the
// concern of the composition root (server/index.ts) via the full PushService.

import type { NotificationChannel } from '../../ports'
import { createPushService } from './service'
import type { PushDeps } from './service'

export function createPushChannel(deps: PushDeps): NotificationChannel {
  return createPushService(deps).channel
}
