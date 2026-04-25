import type { RouteContext } from "../routes"
import { json, jsonError } from "../middlewares/json"
import { CORS_HEADERS } from "../middlewares/cors"
import { extractDirectory } from "./system"
import type { Project } from "@opencode-ai/sdk"

export async function listProjects({ deps }: RouteContext): Promise<Response> {
  try {
    const result = await deps.client.project.list()
    const projects: Array<Project> = result.data ?? []
    return json({ projects }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: project.list", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}

export async function getCurrentProject({ url, deps }: RouteContext): Promise<Response> {
  const dirParam = extractDirectory(url)
  if (dirParam === null)
    return jsonError("INVALID_DIRECTORY", "Internal error: the dashboard sent an invalid directory path. Try refreshing the page; if it persists, report at https://github.com/lesquel/open-remote-control/issues.", 400, CORS_HEADERS)
  try {
    const result = await deps.client.project.current({ query: { ...dirParam } })
    return json({ project: result.data ?? null }, 200, CORS_HEADERS)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error("SDK call failed: project.current", { error: message })
    return jsonError("SDK_ERROR", "SDK call failed", 500, CORS_HEADERS)
  }
}
