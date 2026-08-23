import type { Device, DeviceCapability, DeviceRole } from "../../core/devices/store"
import { capabilitiesForRole } from "../../core/devices/store"
import { getBearerToken, safeEqual } from "../../infra/http/auth"
import type { RouteDeps } from "./routes"

export interface RoutePrincipal {
  kind: "legacy" | "device"
  id: string
  role: DeviceRole
  capabilities: readonly DeviceCapability[]
  device?: Device
}

export function authenticateCredential(
  credential: string | null,
  deps: Pick<RouteDeps, "token" | "deviceStore">,
): RoutePrincipal | null {
  if (credential === null) return null
  if (safeEqual(credential, deps.token)) {
    return {
      kind: "legacy",
      id: "legacy",
      role: "admin",
      capabilities: capabilitiesForRole("admin"),
    }
  }
  const device = deps.deviceStore?.authenticate(credential) ?? null
  if (!device) return null
  return {
    kind: "device",
    id: device.id,
    role: device.role,
    capabilities: device.capabilities,
    device,
  }
}

export function authenticateRequest(
  request: Request,
  deps: Pick<RouteDeps, "token" | "deviceStore">,
): RoutePrincipal | null {
  return authenticateCredential(getBearerToken(request), deps)
}

export function hasCapabilities(
  principal: RoutePrincipal,
  required: readonly DeviceCapability[],
): boolean {
  return required.every((capability) => principal.capabilities.includes(capability))
}
