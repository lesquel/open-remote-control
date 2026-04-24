# Specification: Project State Mode

**Domain**: State Persistence, Configuration  
**Change**: project-state-opt-in  
**Date**: 2026-04-24  
**Status**: Implemented & Verified

---

## Purpose

Define when OpenCode Pilot writes per-project state and banner files to `<project>/.opencode/`. The new three-mode configuration (`off | auto | always`, default `auto`) governs opt-in behavior while preserving the global state path fallback for TUI operations.

---

## Feature: Project State Mode

### REQ-PSM-01: Config field projectStateMode

**Definition**: Expose `projectStateMode: "off" | "auto" | "always"` in shared config.

- Default: `"auto"`
- Environment variable: `PILOT_PROJECT_STATE`
- Invalid values throw `ConfigError` at startup
- Backed by settings store (`~/.opencode-pilot/config.json`)

**Scenarios**:
- Valid env var (`off`, `auto`, `always`) is accepted and takes precedence
- Invalid env var throws immediately with helpful error message
- Missing env var defaults to `"auto"`
- Settings store value is used when env var not set

---

### REQ-PSM-02: Write predicate shouldWriteProjectState

**Definition**: Pure predicate function exported from `state.ts`.

```ts
export function shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean
```

**Semantics**:
- `"off"` → always `false` (skip all per-project writes)
- `"always"` → always `true` (preserve legacy always-create)
- `"auto"` → `true` iff `<directory>/.opencode/` exists (no side effects)

**Scenarios**:
- Off mode returns `false` unconditionally
- Always mode returns `true` unconditionally
- Auto mode checks existence without creating
- Auto mode with empty/invalid directory returns `false`

---

### REQ-PSM-03: writeState mode parameter

**Definition**: Gate per-project file writes through the predicate.

```ts
export function writeState(
  directory: string,
  state: PilotState,
  mode: ProjectStateMode = "auto"
): WriteStateResult
```

**Behavior**:
- When predicate returns `false`: skip per-project write, still write global
- When predicate returns `true`: write per-project file as before
- Global path (`~/.opencode-pilot/pilot-state.json`) always written in all modes

**Scenarios**:
- `mode="off"` + virgin directory → no `.opencode/` created, global written
- `mode="auto"` + no `.opencode/` → no per-project write, no dir created
- `mode="auto"` + pre-existing `.opencode/` → per-project file written
- `mode="always"` + virgin directory → `.opencode/` created, file written
- `clearState` idempotent after skipped write (ENOENT swallowed)

---

### REQ-PSM-04: writeBanner mode parameter

**Definition**: Gate per-project banner write through the predicate.

```ts
export interface BannerOptions {
  localUrl: string
  publicUrl: string | null
  token: string
  directory: string
  pwaUrl?: string | null
  projectStateMode?: ProjectStateMode
}
```

**Behavior**:
- When predicate returns `false`: skip per-project banner, still write global
- When predicate returns `true`: write per-project banner file
- Global banner (`~/.opencode-pilot/pilot-banner.txt`) always written
- Unguarded `join(directory, ".opencode", ...)` wrapped in try/catch

**Scenarios**:
- `mode="off"` → global banner written, no per-project
- `mode="always"` → per-project banner created/written
- `mode="auto"` + no dir → skips per-project, global written
- `mode="auto"` + pre-existing → per-project banner written
- Invalid directory path does not crash (try/catch catches)

---

### REQ-PSM-05: Settings UI integration

**Definition**: Expose and edit `projectStateMode` via HTTP settings API.

**GET /settings response includes**:
```json
{
  "projectStateMode": "auto" | "off" | "always",
  "projectStateModePin": "env" | undefined
}
```

**PATCH /settings accepts**:
```json
{ "projectStateMode": "auto" | "off" | "always" }
```

**Behavior**:
- Invalid value returns 400 with validation error
- Shell-env pinned value returns 409 `SHELL_ENV_PINNED`
- Valid unpinned PATCH persists to config.json

**Scenarios**:
- Settings response includes effective mode
- Settings response shows pin flag when env set
- PATCH with pinned env → 409
- PATCH with valid value → 200, persists
- PATCH with invalid value → 400

---

### REQ-PSM-06: TUI read fallback unchanged

**Definition**: TUI continues to prefer per-project file, falls back to global.

**Behavior**:
- Read logic untouched (`[project, global]` chain)
- Write mode does NOT affect read fallback
- Global state always serves as fallback

---

## Configuration

### Environment Variable

- Name: `PILOT_PROJECT_STATE`
- Valid values: `off`, `auto`, `always`
- Default: `auto` (if unset)
- Precedence: env > settings store > default

### Settings Store Field

- Key: `projectStateMode` in `~/.opencode-pilot/config.json`
- Type: `string` (union of three values)
- Persisted: yes
- Editable via UI: yes (unless shell-env pinned)
- Restart required: no (takes effect on next `activatePrimary`)

---

## Migration & Rollback

### Migration Path

- **Existing workspaces** with `.opencode/` see no change (auto writes when present)
- **New workspaces** no longer get automatic `.opencode/` creation (desired fix)
- **Legacy behavior** available via `PILOT_PROJECT_STATE=always` (immediate, no redeploy)

### Rollback

1. Runtime: `PILOT_PROJECT_STATE=always` or update settings to `{ "projectStateMode": "always" }`
2. Code: Remove field from Config, drop predicate, restore unconditional writes

---

## Testing Strategy

All modes tested via unit + integration:

| Requirement | Coverage |
|---|---|
| Config parsing | 5 unit tests (parseProjectStateMode) |
| Write predicate | 5 unit tests (off/auto-nodir/auto-withdir/always/edge) |
| writeState logic | 5 unit tests (mode matrix + clearState guard) |
| writeBanner logic | 5 unit tests (mode matrix + invalid directory) |
| Settings integration | 3 integration tests (GET, PATCH, 409 pin) |
| Validator | 3 unit tests (valid/invalid/type checks) |

**Total**: 26 tests, all passing, 262-test suite clean.

---

## Non-Goals

- No automatic `.gitignore` injection
- No changes to `clearState` semantics (already idempotent)
- No TUI read chain modifications
- No legacy code removal (only predicate addition)

---

## Related

**GitHub Issue**: #2 (arbitrary `.opencode/` creation)  
**Origin PR**: project-state-opt-in change (2026-04-24)  
**Links**:
- Proposal: Observation #3325
- Spec: Observation #3326 (detailed scenarios)
- Design: Observation #3327 (architecture + decisions)
