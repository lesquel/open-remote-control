import { describe, expect, test } from "bun:test"
import type { Config } from "../config"
import type { AuditLog } from "./audit"
import type { Logger } from "../util/logger"
import { createPushService } from "./push"

function makeDeps(vapid: Config["vapid"] = null) {
  const audit: AuditLog = { log: () => {} }
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
  const config: Config = {
    port: 4097,
    host: "127.0.0.1",
    permissionTimeoutMs: 300_000,
    tunnel: "off",
    telegram: null,
    dev: false,
    vapid,
    enableGlobOpener: false,
  }
  return { config, audit, logger }
}

const SUB_A = {
  endpoint: "https://push.example.com/endpoint/a",
  keys: { p256dh: "p256dh-a", auth: "auth-a" },
}

const SUB_B = {
  endpoint: "https://push.example.com/endpoint/b",
  keys: { p256dh: "p256dh-b", auth: "auth-b" },
}

describe("push service", () => {
  test("isEnabled is false when VAPID is not configured", () => {
    const svc = createPushService(makeDeps(null))
    expect(svc.isEnabled()).toBe(false)
  })

  test("isEnabled is true when VAPID is configured", () => {
    const svc = createPushService(
      makeDeps({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b" }),
    )
    expect(svc.isEnabled()).toBe(true)
  })

  test("addSubscription stores the subscription", () => {
    const svc = createPushService(makeDeps())
    svc.addSubscription(SUB_A)
    svc.addSubscription(SUB_B)
    expect(svc.count()).toBe(2)
  })

  test("addSubscription is idempotent on same endpoint", () => {
    const svc = createPushService(makeDeps())
    svc.addSubscription(SUB_A)
    svc.addSubscription({ ...SUB_A, keys: { p256dh: "x", auth: "y" } })
    expect(svc.count()).toBe(1)
  })

  test("addSubscription rejects invalid shape", () => {
    const svc = createPushService(makeDeps())
    // @ts-expect-error intentionally bad input
    svc.addSubscription({ endpoint: "no-keys" })
    // @ts-expect-error intentionally bad input
    svc.addSubscription(null)
    // @ts-expect-error intentionally bad input
    svc.addSubscription({ endpoint: "", keys: { p256dh: "a", auth: "b" } })
    expect(svc.count()).toBe(0)
  })

  test("removeSubscription deletes by endpoint", () => {
    const svc = createPushService(makeDeps())
    svc.addSubscription(SUB_A)
    svc.addSubscription(SUB_B)
    svc.removeSubscription(SUB_A.endpoint)
    expect(svc.count()).toBe(1)
  })

  test("broadcast is a no-op when VAPID is disabled", async () => {
    const svc = createPushService(makeDeps(null))
    svc.addSubscription(SUB_A)
    // Should resolve without throwing, without attempting any network I/O
    await svc.broadcast({ title: "t", body: "b" })
    expect(svc.count()).toBe(1)
  })

  test("broadcast is a no-op when there are no subs", async () => {
    const svc = createPushService(
      makeDeps({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b" }),
    )
    await svc.broadcast({ title: "t", body: "b" })
    expect(svc.count()).toBe(0)
  })

  test("sendTo returns false for unknown endpoint", async () => {
    const svc = createPushService(
      makeDeps({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b" }),
    )
    const ok = await svc.sendTo("unknown", { title: "t", body: "b" })
    expect(ok).toBe(false)
  })
})
