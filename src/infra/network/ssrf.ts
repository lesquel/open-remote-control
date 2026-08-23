import { BlockList, isIP } from "node:net"

type AddressFamily = "ipv4" | "ipv6"

const NON_PUBLIC_IPV4 = new BlockList()
const NON_PUBLIC_IPV6 = new BlockList()

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_IPV4.addSubnet(address, prefix, "ipv4")
  NON_PUBLIC_IPV6.addSubnet(`::ffff:${address}`, 96 + prefix, "ipv6")
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC_IPV6.addSubnet(address, prefix, "ipv6")
}

function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  return unbracketed.toLowerCase().replace(/\.$/, "")
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false
  const type: AddressFamily = family === 4 ? "ipv4" : "ipv6"
  const blockList = type === "ipv4" ? NON_PUBLIC_IPV4 : NON_PUBLIC_IPV6
  return !blockList.check(address, type)
}

/** Validate the URL shape and any literal IP before an outbound HTTPS request. */
export function validateEndpoint(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'endpoint must use https:' }
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "endpoint credentials are not allowed" }
  }

  const hostname = normalizeHostname(url.hostname)
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: 'localhost endpoints are not allowed' }
  }
  if (isIP(hostname) !== 0 && !isPublicIpAddress(hostname)) {
    return { ok: false, reason: "non-public IP address not allowed" }
  }
  return { ok: true }
}
