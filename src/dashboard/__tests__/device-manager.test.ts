import { describe, expect, test } from "bun:test"
import { createDeviceManager, type DeviceView } from "../modals/device-manager.js"

function device(patch: Partial<DeviceView> = {}): DeviceView {
  return {
    id: "device-1",
    name: "Phone",
    role: "operator",
    lastActiveAt: 1_700_000_000_000,
    expiresAt: null,
    revokedAt: null,
    ...patch,
  }
}

describe("connected device manager", () => {
  test("renders current-device identity and all capability roles", async () => {
    const manager = createDeviceManager({
      fetchDevices: async () => ({ devices: [device()], currentDeviceId: "device-1" }),
      toast: () => {},
    })
    await manager.refresh()
    const html = manager.render()
    expect(html).toContain("This device")
    expect(html).toContain('value="read-only"')
    expect(html).toContain('value="interactive"')
    expect(html).toContain('value="operator" selected')
    expect(html).toContain('value="admin"')
  })

  test("escapes device-controlled names and ignores undeclared credential material", async () => {
    const untrusted = {
      ...device({ name: '<img src=x onerror="alert(1)"> & phone' }),
      tokenHash: "must-not-render",
    } as DeviceView
    const manager = createDeviceManager({
      fetchDevices: async () => ({
        devices: [untrusted],
        currentDeviceId: null,
      }),
      toast: () => {},
    })
    await manager.refresh()
    const html = manager.render()
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).not.toContain("must-not-render")
  })

  test("shows a clear authorization state to non-admin devices", async () => {
    const manager = createDeviceManager({
      fetchDevices: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }) },
      toast: () => {},
    })
    await manager.refresh()
    expect(manager.render()).toContain("Only admin devices")
  })

  test("disables controls for revoked devices", async () => {
    const manager = createDeviceManager({
      fetchDevices: async () => ({ devices: [device({ revokedAt: Date.now() })], currentDeviceId: null }),
      toast: () => {},
    })
    await manager.refresh()
    const html = manager.render()
    expect(html).toContain("Revoked or expired")
    expect(html).toContain("is-inactive")
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
