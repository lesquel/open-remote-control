import { writeFileSync } from "fs"
import { join } from "path"
import { generateQR } from "./qr"

const DEFAULT_PWA_URL = "https://lesquel.github.io/open-remote-control/"

export interface BannerOptions {
  localUrl: string
  publicUrl: string | null
  token: string
  directory: string
  /** Optional: override the hosted PWA URL (defaults to GitHub Pages deployment). */
  pwaUrl?: string | null
}

/**
 * Encode a server URL + token into a base64 string for PWA deep-links.
 * Format: base64(serverUrl|token)
 * The PWA parses this from #connect=<encoded>
 */
function encodePwaConnect(serverUrl: string, token: string): string {
  return Buffer.from(`${serverUrl}|${token}`).toString("base64")
}

/**
 * Generates the startup banner text, prints the QR code, and writes the
 * banner to `.opencode/pilot-banner.txt` for the TUI to read.
 */
export async function writeBanner(opts: BannerOptions): Promise<string> {
  const { localUrl, publicUrl, token, directory, pwaUrl } = opts

  // Direct dashboard link (tunnel URL or local)
  const dashboardUrl = `${publicUrl ?? localUrl}/?token=${token}`

  // PWA pairing link — only generated when a public tunnel is active
  const resolvedPwaUrl =
    pwaUrl !== undefined ? pwaUrl : (process.env.PILOT_PWA_URL ?? DEFAULT_PWA_URL)
  const pwaLink =
    resolvedPwaUrl && publicUrl
      ? `${resolvedPwaUrl.replace(/\/$/, "")}/#connect=${encodePwaConnect(publicUrl, token)}`
      : null

  const qrTarget = pwaLink ?? dashboardUrl
  const qr = await generateQR(qrTarget)

  const localhostNote =
    !publicUrl &&
    (localUrl.includes("127.0.0.1") || localUrl.includes("localhost"))
      ? `\n   NOTE: Server bound to localhost — QR won't work from other devices.\n         Set PILOT_HOST=0.0.0.0 to bind to all interfaces.\n`
      : ""

  const publicLine = publicUrl ? `   Public: ${publicUrl}\n` : ""
  const pwaLine = pwaLink ? `   PWA:    ${pwaLink}\n` : ""

  const qrLabel = pwaLink
    ? `   Scan QR to open in PWA (${resolvedPwaUrl}):`
    : `   Scan QR to open dashboard on mobile:`

  const banner = [
    ``,
    `OpenCode Pilot — Remote Control`,
    `================================`,
    ``,
    `   Local:  ${localUrl}`,
    publicLine.trimEnd(),
    pwaLine.trimEnd(),
    `   Token:  ${token}`,
    ``,
    `   curl -H "Authorization: Bearer ${token}" ${localUrl}/status`,
    localhostNote,
    qrLabel,
    ``,
    qr,
    `   Direct link: ${dashboardUrl}`,
    ``,
  ]
    .filter((line) => line !== "")
    .join("\n")

  try {
    writeFileSync(join(directory, ".opencode", "pilot-banner.txt"), banner)
  } catch {
    // Silent fail — .opencode directory may not exist yet in edge cases
  }

  return banner
}
