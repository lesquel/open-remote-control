# Add an agent integration

Add bridged agents inside `src/integrations/<agent>/`, describe their real capabilities, and register them in the composition root. The core and dashboard must not grow provider-name conditionals.

## Quick path

1. Create `src/integrations/<agent>/index.ts` plus colocated validators, handlers, and tests.
2. Build the descriptor with `createAgentIntegration()` from `src/integrations/ports.ts`.
3. Register routes through `deps.registerRoute()`; do not edit the central route table.
4. Import the integration in `src/server/index.ts`, include its descriptor in `deps.integrations`, call `setup()`, and include its handle in shutdown.
5. Run the integration contract test, focused adapter tests, then the full release guard.

Codex is the smallest current example. OpenCode is an intentional native-SDK exception because its SDK requires hooks to be returned from the plugin factory instead of registered imperatively.

## Contract

```ts
const exampleIntegration = createAgentIntegration({
  id: "example",
  displayName: "Example Agent",
  capabilities: {
    sessions: false,
    streaming: false,
    permissions: true,
    tools: true,
    cost: false,
    todos: false,
    files: false,
    models: false,
    agents: false,
  },
}, (deps) => {
  deps.registerRoute?.({
    method: "POST",
    pattern: /^\/example\/hooks\/(?<event>[A-Za-z]+)$/,
    auth: "none",
    handler: handleExampleHook,
  })

  return { shutdown: async () => {} }
})
```

`auth: "none"` is safe only when the handler performs its own integration-specific authentication, as the Codex bridge does. Otherwise declare route capabilities and let the HTTP boundary authenticate before dispatch.

## Capability rules

Capabilities describe behavior that works end to end, not planned features. The protected `GET /integrations` endpoint exposes them to the dashboard and diagnostics.

| Capability | Set `true` only when |
|---|---|
| `sessions` | sessions can be listed or addressed reliably |
| `streaming` | incremental agent output reaches the event stream |
| `permissions` | pending decisions can be resolved safely |
| `tools` | tool activity has stable identifiers and lifecycle events |
| `cost` | the provider reports reliable usage or cost data |
| `todos` | task state is available |
| `files` | project-scoped file operations are supported |
| `models` | model metadata is available |
| `agents` | named agent or mode selection is supported |

Do not report OpenCode parity by default. Unsupported UI must remain hidden or clearly unavailable.

## Security boundaries

- Validate unknown JSON before using it; keep validators beside the adapter.
- Bound request bodies and strings before storing or emitting them.
- Authenticate hook routes with a dedicated secret where the agent supports one.
- Never log prompts, credentials, tool inputs, or raw provider errors.
- Emit project and session identity whenever the upstream event provides them.
- Use argv arrays for child processes; do not interpolate shell commands.
- Return a shutdown handle that clears timers, listeners, and child processes.

## Test checklist

- [ ] Run `runAgentIntegrationContractTests()` from `src/integrations/ports.test.ts` against the descriptor.
- [ ] Reject malformed, oversized, unauthenticated, and unknown hook events.
- [ ] Prove events cannot cross session or project identity.
- [ ] Prove duplicate permission resolution is harmless.
- [ ] Prove `shutdown()` is idempotent and releases resources.
- [ ] Run `bun scripts/prepublish-guard.ts`, `tsc --noEmit`, and `bun test`.

## Files a normal adapter should change

The target is one integration folder plus composition-root registration and tests. If a new adapter requires provider checks in `core/`, `transport/http/routes.ts`, or unrelated dashboard modules, stop and improve the shared contract instead.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for dependency rules and [`CODEX-INTEGRATION.md`](./CODEX-INTEGRATION.md) for the existing hook bridge.
