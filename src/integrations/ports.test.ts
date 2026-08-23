import { describe, expect, test } from "bun:test"
import { createAgentIntegration, type AgentDescriptor } from "./ports"
import { codexIntegration } from "./codex"
import { opencodeIntegration } from "./opencode"

const CAPABILITY_KEYS = [
  "sessions",
  "streaming",
  "permissions",
  "tools",
  "cost",
  "todos",
  "files",
  "models",
  "agents",
] as const

function runAgentDescriptorContract(descriptor: AgentDescriptor): void {
  test(`${descriptor.id} has stable, complete metadata`, () => {
    expect(descriptor.id).toMatch(/^[a-z][a-z0-9-]{0,63}$/)
    expect(descriptor.displayName.trim().length).toBeGreaterThan(0)
    expect(Object.keys(descriptor.capabilities).sort()).toEqual([...CAPABILITY_KEYS].sort())
    for (const capability of CAPABILITY_KEYS) {
      expect(typeof descriptor.capabilities[capability]).toBe("boolean")
    }
  })
}

describe("agent integration contract", () => {
  runAgentDescriptorContract(opencodeIntegration)
  runAgentDescriptorContract(codexIntegration)

  test("Codex exposes only capabilities implemented by its hook bridge", () => {
    expect(codexIntegration.capabilities.permissions).toBe(true)
    expect(codexIntegration.capabilities.tools).toBe(true)
    expect(codexIntegration.capabilities.sessions).toBe(false)
    expect(codexIntegration.capabilities.streaming).toBe(false)
  })

  test("factory rejects identifiers that are unsafe for protocol use", () => {
    expect(() => createAgentIntegration({
      id: "Claude Code",
      displayName: "Claude Code",
      capabilities: {
        sessions: false,
        streaming: false,
        permissions: false,
        tools: false,
        cost: false,
        todos: false,
        files: false,
        models: false,
        agents: false,
      },
    }, () => ({ shutdown: async () => {} }))).toThrow("Invalid agent integration id")
  })
})
