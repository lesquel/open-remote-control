import { createOpencodeClient } from "@opencode-ai/sdk/v2"

export interface OpenCodeAttentionClientOptions {
  baseUrl: string | URL
  password?: string
  username?: string
}

/**
 * The plugin SDK client is already authenticated by OpenCode, but the v2
 * attention APIs require a separate client. Mirror OpenCode server Basic auth
 * here when it is configured; the password is only used to construct the
 * in-memory request header and is never logged or persisted.
 */
export function createOpenCodeAttentionClient({
  baseUrl,
  password,
  username = "opencode",
}: OpenCodeAttentionClientOptions) {
  const headers = password
    ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }
    : undefined

  return createOpencodeClient({
    baseUrl: baseUrl.toString(),
    headers,
  })
}
