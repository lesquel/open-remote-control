// pick-default-agent.test.ts — Unit tests for pickDefaultAgent helper.
// Tests the pure function that selects a default agent from the /agents list.
import { describe, it, expect } from "bun:test"
import { pickDefaultAgent } from "../components/default-agent.js"

// ── Inline Agent type (mirrors @opencode-ai/sdk shape) ────────────────────
type Agent = {
  name: string
  description?: string
  color?: string
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("pickDefaultAgent", () => {
  it("returns null for an empty list", () => {
    expect(pickDefaultAgent([])).toBeNull()
  })

  it("returns null for a falsy/undefined argument cast as empty", () => {
    // The JS surface accepts undefined at runtime even though TS types it as Agent[]
    expect(pickDefaultAgent(null as unknown as Agent[])).toBeNull()
    expect(pickDefaultAgent(undefined as unknown as Agent[])).toBeNull()
  })

  it("returns the single agent when list has one entry", () => {
    const agents: Agent[] = [{ name: "build", description: "Default build agent" }]
    expect(pickDefaultAgent(agents)).toEqual(agents[0])
  })

  it("returns the first agent when no explicit default flag", () => {
    const agents: Agent[] = [
      { name: "build" },
      { name: "plan" },
      { name: "review" },
    ]
    expect(pickDefaultAgent(agents)?.name).toBe("build")
  })

  it("returns the agent marked default:true even when it is not first", () => {
    const agents = [
      { name: "build" },
      { name: "plan", default: true },
      { name: "review" },
    ]
    expect(pickDefaultAgent(agents as unknown as Agent[])?.name).toBe("plan")
  })

  it("ignores default:false and still picks first", () => {
    const agents = [
      { name: "build", default: false },
      { name: "plan" },
    ]
    expect(pickDefaultAgent(agents as unknown as Agent[])?.name).toBe("build")
  })

  it("returns the first agent regardless of array length > 2", () => {
    const agents: Agent[] = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      color: `hsl(${i * 36}, 50%, 60%)`,
    }))
    expect(pickDefaultAgent(agents)?.name).toBe("agent-0")
  })
})
