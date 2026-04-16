import { networkInterfaces } from "os"

/**
 * Returns the first non-loopback IPv4 address found in the system's network
 * interfaces. Useful for generating LAN-accessible QR URLs when the server
 * is bound to 0.0.0.0.
 */
export function getLocalIP(): string | null {
  const nets = networkInterfaces()
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address
      }
    }
  }
  return null
}
