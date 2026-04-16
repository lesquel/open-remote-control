import { writeFileSync } from "fs"
import { join } from "path"
import { generateQR } from "./qr"

export interface BannerOptions {
  localUrl: string
  publicUrl: string | null
  token: string
  directory: string
}

/**
 * Generates the startup banner text, prints the QR code, and writes the
 * banner to `.opencode/pilot-banner.txt` for the TUI to read.
 */
export async function writeBanner(opts: BannerOptions): Promise<string> {
  const { localUrl, publicUrl, token, directory } = opts
  const dashboardUrl = `${publicUrl ?? localUrl}/?token=${token}`

  const qr = await generateQR(dashboardUrl)

  const localhostNote =
    !publicUrl &&
    (localUrl.includes("127.0.0.1") || localUrl.includes("localhost"))
      ? `\n   NOTE: Server bound to localhost — QR won't work from other devices.\n         Set PILOT_HOST=0.0.0.0 to bind to all interfaces.\n`
      : ""

  const publicLine = publicUrl ? `   Public: ${publicUrl}\n` : ""

  const banner = [
    ``,
    `OpenCode Pilot — Remote Control`,
    `================================`,
    ``,
    `   Local:  ${localUrl}`,
    publicLine.trimEnd(),
    `   Token:  ${token}`,
    ``,
    `   curl -H "Authorization: Bearer ${token}" ${localUrl}/status`,
    localhostNote,
    `   Scan QR to open dashboard on mobile:`,
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
