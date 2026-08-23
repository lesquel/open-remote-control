export type DeviceView = {
  id: string
  name: string
  role: "read-only" | "interactive" | "operator" | "admin"
  lastActiveAt: number
  expiresAt: number | null
  revokedAt: number | null
}

export type DeviceManagerDeps = {
  fetchDevices?: () => Promise<{ devices: DeviceView[]; currentDeviceId: string | null }>
  updateDevice?: (id: string, patch: { name: string; role: string }) => Promise<unknown>
  revokeDevice?: (id: string) => Promise<unknown>
  toast?: (message: string) => void
  onSelfRevoked?: () => void
}

export function createDeviceManager(deps: DeviceManagerDeps): {
  refresh(): Promise<void>
  render(): string
  wire(container: ParentNode, onRefresh: () => Promise<void>): void
}
