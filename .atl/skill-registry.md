# Skill Registry — opencode-pilot

## Stack
- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Framework**: OpenCode Plugin SDK (@opencode-ai/plugin)
- **Module System**: ESM (type: module)
- **Package Manager**: bun

## Architecture
- `src/server/` — Server-side plugin (HTTP server, hooks, events)
- `src/tui/` — TUI-side plugin (commands, UI slots, notifications)
- `docs/` — Documentation and brainstorming

## Conventions

### Naming
- Files: kebab-case (e.g., `permission-queue.ts`)
- Functions: camelCase, factory pattern with `create` prefix (e.g., `createEventBus()`)
- Types/Interfaces: PascalCase (e.g., `EventBus`, `PermissionQueue`)
- Constants: SCREAMING_SNAKE_CASE for env var defaults

### Module Pattern
- Each module exports a factory function that returns an interface
- No classes — use closures and returned objects
- Dependencies injected via factory function parameters

### Plugin Structure
- Server plugin: `export default { id, server }` in `src/server/index.ts`
- TUI plugin: `export default { id, tui }` in `src/tui/index.ts`
- Package exports: `"./server"` and `"./tui"` in package.json

### Security
- All HTTP endpoints require Bearer token auth
- Default bind to localhost only (127.0.0.1)
- Audit log for every remote operation
- Permission timeouts to prevent indefinite blocking

### Testing
- Test files: `*.test.ts` co-located with source
- Test runner: `bun test`
- Focus on unit tests for auth, permissions, events

## Compact Rules

### TypeScript
- strict mode, no any (except SDK boundaries)
- Prefer type over interface for object shapes
- Use satisfies for type checking without widening

### Plugin SDK
- Server hooks are (input, output) => Promise<void> — mutate output in place
- Event hook is ({ event }) => Promise<void>
- Custom tools use tool() helper with Zod schemas
- TUI and Server are separate modules, can't be in same export

### HTTP
- All responses use JSON with Content-Type header
- CORS headers on every response
- Token via Authorization: Bearer header (SSE allows ?token= query param)
- Rate limiting planned for Phase 2

## User Skills
| Trigger | Skill |
|---------|-------|
| OpenCode plugin development | Read this registry |
| TypeScript strict patterns | typescript |
| Security review | security-best-practices |
