import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildSupportBundle, writePrivateBundle } from "./diagnostics"

function fixture(): { root: string; configDir: string; statePath: string } {
  const root = join(tmpdir(), `pilot-diagnostics-${crypto.randomUUID()}`)
  const configDir = join(root, "opencode")
  const statePath = join(root, "pilot-state.json")
  mkdirSync(join(configDir, "node_modules", "@lesquel", "opencode-pilot"), { recursive: true })
  writeFileSync(join(configDir, "node_modules", "@lesquel", "opencode-pilot", "package.json"), '{"version":"2.0.0"}')
  writeFileSync(join(configDir, "opencode.json"), '{"plugin":["@lesquel/opencode-pilot@latest"]}')
  writeFileSync(join(configDir, "tui.json"), '{"plugin":["@lesquel/opencode-pilot@latest"]}')
  return { root, configDir, statePath }
}

describe("support diagnostics bundle", () => {
  test("whitelists live diagnostics without credentials, device IDs, or error messages", async () => {
    const { configDir, statePath } = fixture()
    writeFileSync(statePath, JSON.stringify({ host: "0.0.0.0", port: 4097, token: "secret-token" }))
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token")
      return Response.json({
        pilot: { version: "2.0.0", futureSecret: "must-not-copy" },
        listener: { host: "private-host", port: 4097, tunnel: { provider: "off", status: "disabled" } },
        authentication: { kind: "device", role: "admin", deviceId: "private-device" },
        runtime: { sseClients: 1, futureSecret: "must-not-copy" },
        configuration: { sources: { port: "default", token: "must-not-copy" }, futureSecret: "must-not-copy" },
        recentErrors: [{ component: "server", message: "/private/path secret-token" }],
      })
    }
    const bundle = await buildSupportBundle({ configDir, statePath, packageVersion: "2.0.0", fetchImpl })
    const json = JSON.stringify(bundle)
    expect(json).toContain('"recentErrorSummary":{"count":1,"components":["server"]}')
    expect(json).not.toContain("secret-token")
    expect(json).not.toContain("private-device")
    expect(json).not.toContain("private-host")
    expect(json).not.toContain("/private/path")
    expect(json).not.toContain("must-not-copy")
  })

  test("writes owner-private output and refuses to overwrite it", async () => {
    const { root, configDir, statePath } = fixture()
    const output = join(root, "support.json")
    const bundle = await buildSupportBundle({ configDir, statePath, packageVersion: "2.0.0", fetchImpl: fetch })
    writePrivateBundle(output, bundle)
    expect(JSON.parse(readFileSync(output, "utf8")).schemaVersion).toBe(1)
    if (process.platform !== "win32") expect(statSync(output).mode & 0o777).toBe(0o600)
    expect(() => writePrivateBundle(output, bundle)).toThrow("Refusing to overwrite")
  })
})
