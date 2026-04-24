import { mkdirSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { generateQR } from "./qr"
import { stateFile } from "../util/paths"
import { shouldWriteProjectState } from "./state"
import type { ProjectStateMode } from "./state"

export function globalBannerPath(): string {
  return stateFile("pilot-banner.txt")
}

function safeWrite(path: string, content: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  } catch {
    // Silent fail — caller tolerates missing banner file.
  }
}

const DEFAULT_PWA_URL = "https://lesquel.github.io/open-remote-control/"

export interface BannerOptions {
  localUrl: string
  publicUrl: string | null
  token: string
  directory: string
  /** Optional: override the hosted PWA URL (defaults to GitHub Pages deployment). */
  pwaUrl?: string | null
  /** Controls per-project banner writes. Defaults to `"auto"`.
   *  - `off`:    Skip per-project write; global always written.
   *  - `auto`:   Write per-project only when `.opencode/` already exists.
   *  - `always`: Always write per-project (creates `.opencode/` if needed).
   */
  projectStateMode?: ProjectStateMode
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
  const { localUrl, publicUrl, token, directory, pwaUrl, projectStateMode = "auto" } = opts

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
      ? `NOTE: Server bound to localhost — QR won't work from other devices.\n      Set PILOT_HOST=0.0.0.0 to bind to LAN, or PILOT_TUNNEL=cloudflared to expose publicly.`
      : ""

  // The primary link the user will actually open. PWA link if tunnel is up
  // (installable, hosted on GitHub Pages); otherwise the direct dashboard link.
  const primaryLink = pwaLink ?? dashboardUrl

  const banner = [
    ``,
    `OpenCode Pilot — Remote Control`,
    `================================`,
    ``,
    `Open this link on your phone (or scan the QR):`,
    ``,
    primaryLink,
    ``,
    qr,
    ``,
    `Details:`,
    `  Local:   ${localUrl}`,
    publicUrl ? `  Public:  ${publicUrl}` : ``,
    pwaLink ? `  PWA:     ${resolvedPwaUrl}` : ``,
    `  Direct:  ${dashboardUrl}`,
    ``,
    localhostNote,
  ]
    .filter((line) => line !== "")
    .join("\n")

  // Dual-write: project path for projects that have an .opencode/ folder
  // (nice for git-tracked workflows), plus a global path the TUI can always
  // read regardless of cwd.
  //
  // Per-project write is gated by shouldWriteProjectState to avoid creating
  // .opencode/ in arbitrary workspaces that haven't opted in. Wrapped in
  // try/catch (consistent with safeWrite) to guard against any edge-case
  // where directory is empty or otherwise not suitable for join().
  if (shouldWriteProjectState(directory, projectStateMode)) {
    try {
      safeWrite(join(directory, ".opencode", "pilot-banner.txt"), banner)
    } catch {
      // Silent fail — same contract as safeWrite.
    }
  }
  safeWrite(globalBannerPath(), banner)

  return banner
}
