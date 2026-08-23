import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createDeviceStore, capabilitiesForRole } from "./store"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup of test-only temporary directories.
    }
  }
})

function tempFile(): string {
  const root = join(process.cwd(), `.tmp-device-store-${crypto.randomUUID()}`)
  roots.push(root)
  return join(root, "devices.json")
}

function logger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
}

describe("device capability roles", () => {
  test("roles grant only their documented capability tier", () => {
    expect(capabilitiesForRole("read-only")).toEqual([
      "status.read",
      "sessions.read",
      "permissions.read",
      "files.read",
      "diff.read",
      "settings.read",
      "notifications.manage",
    ])
    expect(capabilitiesForRole("interactive")).toContain("prompts.send")
    expect(capabilitiesForRole("interactive")).not.toContain("permissions.approve")
    expect(capabilitiesForRole("operator")).toContain("permissions.approve")
    expect(capabilitiesForRole("operator")).toContain("permissions.deny")
    expect(capabilitiesForRole("operator")).not.toContain("devices.manage")
    expect(capabilitiesForRole("admin")).toContain("devices.manage")
    expect(capabilitiesForRole("admin")).toContain("auth.rotate")
  })
})

describe("createDeviceStore", () => {
  test("issues a restart-safe credential without persisting the raw secret", () => {
    const filePath = tempFile()
    const store = createDeviceStore({ filePath, logger: logger() })
    const issued = store.issue({ name: "Phone", role: "operator" })

    const raw = readFileSync(filePath, "utf8")
    expect(raw).not.toContain(issued.credential)
    expect(raw).not.toContain(issued.credential.split(".").at(-1) ?? "missing")
    expect(store.authenticate(issued.credential)?.id).toBe(issued.device.id)

    const restored = createDeviceStore({ filePath, logger: logger() })
    expect(restored.authenticate(issued.credential)?.id).toBe(issued.device.id)
  })

  test("writes owner-private state on POSIX platforms", () => {
    const filePath = tempFile()
    const parent = join(filePath, "..")
    mkdirSync(parent, { recursive: true, mode: 0o777 })
    chmodSync(parent, 0o777)

    createDeviceStore({ filePath, logger: logger() }).issue({ name: "Phone", role: "read-only" })

    if (process.platform !== "win32") {
      expect(statSync(parent).mode & 0o777).toBe(0o700)
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  test("revokes only the selected device", () => {
    const store = createDeviceStore({ filePath: tempFile(), logger: logger() })
    const phone = store.issue({ name: "Phone", role: "operator" })
    const laptop = store.issue({ name: "Laptop", role: "read-only" })

    expect(store.revoke(phone.device.id)).toBe(true)
    expect(store.authenticate(phone.credential)).toBeNull()
    expect(store.authenticate(laptop.credential)?.id).toBe(laptop.device.id)
    expect(store.revoke("missing")).toBe(false)
  })

  test("rejects malformed, unknown, and expired credentials", () => {
    let now = 1_000
    const store = createDeviceStore({ filePath: tempFile(), logger: logger(), now: () => now })
    const issued = store.issue({ name: "Temporary", role: "interactive", expiresAt: 1_100 })

    expect(store.authenticate("not-a-device-token")).toBeNull()
    expect(store.authenticate(`${issued.credential}x`)).toBeNull()
    now = 1_100
    expect(store.authenticate(issued.credential)).toBeNull()
  })

  test("redeems a short-lived pairing token exactly once", () => {
    let now = 5_000
    const store = createDeviceStore({ filePath: tempFile(), logger: logger(), now: () => now })
    const pairing = store.createPairing({ role: "operator", ttlMs: 500 })

    const issued = store.redeemPairing({ token: pairing.token, name: "Miquel's phone" })
    expect(issued?.device.role).toBe("operator")
    expect(store.redeemPairing({ token: pairing.token, name: "Replay" })).toBeNull()

    const expired = store.createPairing({ role: "read-only", ttlMs: 100 })
    now += 100
    expect(store.redeemPairing({ token: expired.token, name: "Late" })).toBeNull()
  })

  test("keeps ephemeral pairing secrets out of persistent state", () => {
    const filePath = tempFile()
    const store = createDeviceStore({ filePath, logger: logger() })
    store.issue({ name: "Existing", role: "admin" })
    const pairing = store.createPairing({ role: "read-only", ttlMs: 60_000 })

    expect(readFileSync(filePath, "utf8")).not.toContain(pairing.token)
    const restarted = createDeviceStore({ filePath, logger: logger() })
    expect(restarted.redeemPairing({ token: pairing.token, name: "After restart" })).toBeNull()
  })

  test("refuses an unknown future schema without overwriting it", () => {
    const filePath = tempFile()
    mkdirSync(join(filePath, ".."), { recursive: true })
    const future = '{"version":99,"devices":[{"future":true}]}\n'
    writeFileSync(filePath, future)

    const store = createDeviceStore({ filePath, logger: logger() })
    expect(store.list()).toEqual([])
    expect(() => store.issue({ name: "Phone", role: "admin" })).toThrow("unsupported device state version")
    expect(readFileSync(filePath, "utf8")).toBe(future)
  })

  test("recovers from malformed state without exposing partial records", () => {
    const filePath = tempFile()
    mkdirSync(join(filePath, ".."), { recursive: true })
    writeFileSync(filePath, "not-json")

    const store = createDeviceStore({ filePath, logger: logger() })
    expect(store.list()).toEqual([])
    const issued = store.issue({ name: "Recovered", role: "read-only" })
    expect(existsSync(filePath)).toBe(true)
    expect(store.authenticate(issued.credential)?.name).toBe("Recovered")
  })
})
