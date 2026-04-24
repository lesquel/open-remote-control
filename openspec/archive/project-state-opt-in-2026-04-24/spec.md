# Spec: project-state-opt-in

## Affected Capabilities

| Capability | Type | Domain |
|---|---|---|
| state-persistence | New (no prior spec) | Config, write predicate, state/banner writers |
| settings-store | New (no prior spec) | HTTP settings API + shell-env pinning |
| docs | New | README / CONFIGURATION.md |

---

# State-Persistence Specification

## Purpose

Govern when per-project files are written to `<project>/.opencode/`.
Global path writes remain unconditional. Mode is sourced from env var or settings store.

## Requirements

### Requirement: Config field projectStateMode

The system MUST expose `projectStateMode: "off" | "auto" | "always"` in the shared config.
The default MUST be `"auto"`.
The value MUST be sourced from the `PILOT_PROJECT_STATE` environment variable when set.
An invalid value for `PILOT_PROJECT_STATE` MUST throw `ConfigError` at load time (same pattern as `PILOT_TUNNEL`).

#### Scenario: Valid env var is accepted

- GIVEN `PILOT_PROJECT_STATE` is set to `"off"`, `"auto"`, or `"always"`
- WHEN config is loaded
- THEN `config.projectStateMode` equals the env var value
- AND no error is thrown

#### Scenario: Invalid env var fails fast at startup

- GIVEN `PILOT_PROJECT_STATE` is set to `"invalid"`
- WHEN config is loaded
- THEN a `ConfigError` is thrown before the server starts
- AND the error message names `PILOT_PROJECT_STATE` and lists valid values

#### Scenario: Default when env var absent

- GIVEN `PILOT_PROJECT_STATE` is not set in the environment
- WHEN config is loaded
- THEN `config.projectStateMode` equals `"auto"`

---

### Requirement: Write predicate shouldWriteProjectState

The system MUST export `shouldWriteProjectState(directory: string, mode: ProjectStateMode): boolean` from `state.ts`.
- `"off"` MUST return `false` unconditionally.
- `"always"` MUST return `true` unconditionally.
- `"auto"` MUST return `true` if and only if `<directory>/.opencode/` already exists.
- `"auto"` MUST NOT create the directory as a side effect.

#### Scenario: Off mode always returns false

- GIVEN mode is `"off"`
- WHEN `shouldWriteProjectState` is called with any directory
- THEN it returns `false`
- AND no filesystem access occurs

#### Scenario: Always mode always returns true

- GIVEN mode is `"always"`
- WHEN `shouldWriteProjectState` is called with any directory
- THEN it returns `true`

#### Scenario: Auto mode returns false for virgin workspace

- GIVEN mode is `"auto"`
- AND `<directory>/.opencode/` does NOT exist
- WHEN `shouldWriteProjectState` is called
- THEN it returns `false`
- AND `<directory>/.opencode/` still does NOT exist afterward

#### Scenario: Auto mode returns true when directory present

- GIVEN mode is `"auto"`
- AND `<directory>/.opencode/` already exists
- WHEN `shouldWriteProjectState` is called
- THEN it returns `true`

---

### Requirement: writeState respects mode

`writeState` MUST skip all per-project file writes when `shouldWriteProjectState` returns `false`.
Global path writes (`~/.opencode-pilot/pilot-state.json`) MUST occur in every mode.

#### Scenario: Off mode writes global only

- GIVEN mode is `"off"`
- WHEN `writeState` is called with a project directory
- THEN `~/.opencode-pilot/pilot-state.json` is written
- AND no files are written under `<directory>/.opencode/`
- AND `<directory>/.opencode/` is not created

#### Scenario: Auto mode does not mutate a virgin workspace

- GIVEN mode is `"auto"`
- AND `<directory>/.opencode/` does NOT exist
- WHEN `writeState` is called
- THEN no files are written under `<directory>/.opencode/`
- AND `<directory>/.opencode/` is not created
- AND global state file is written

#### Scenario: Auto mode writes project file when directory present

- GIVEN mode is `"auto"`
- AND `<directory>/.opencode/` exists
- WHEN `writeState` is called
- THEN `<directory>/.opencode/pilot-state.json` is written

#### Scenario: Always mode preserves legacy behavior

- GIVEN mode is `"always"`
- AND `<directory>/.opencode/` does NOT exist
- WHEN `writeState` is called
- THEN `<directory>/.opencode/` is created
- AND `<directory>/.opencode/pilot-state.json` is written

---

### Requirement: writeBanner respects mode

`writeBanner` MUST gate the per-project file branch through `shouldWriteProjectState`.
The previously unguarded `join(directory, ".opencode", ...)` path MUST be guarded.
Global banner write (`~/.opencode-pilot/pilot-banner.txt`) MUST occur in every mode.

#### Scenario: Off mode skips per-project banner

- GIVEN mode is `"off"`
- WHEN `writeBanner` is called
- THEN `~/.opencode-pilot/pilot-banner.txt` is written
- AND no file is written under `<directory>/.opencode/`

#### Scenario: Always mode writes per-project banner

- GIVEN mode is `"always"`
- WHEN `writeBanner` is called
- THEN `<directory>/.opencode/pilot-banner.txt` is written

---

### Requirement: TUI read fallback chain unchanged

The TUI read path MUST still attempt the per-project file first and fall back to the global file.
This behavior MUST NOT be affected by any write mode.

#### Scenario: TUI reads global fallback when project file absent

- GIVEN `<directory>/.opencode/pilot-state.json` does NOT exist
- AND `~/.opencode-pilot/pilot-state.json` exists
- WHEN the TUI reads state
- THEN the global file content is returned
- AND no error is thrown

---

# Settings-Store Specification

## Purpose

Expose `projectStateMode` through the HTTP settings API with three-way union validation
and shell-env pinning consistent with existing `tunnel` field handling.

## Requirements

### Requirement: GET /settings exposes projectStateMode

`GET /settings` MUST include `projectStateMode` in the response body with:
- the current effective value
- a `pinnedByEnv: true` flag when `PILOT_PROJECT_STATE` is set in the shell environment

#### Scenario: Settings shows effective value and pin flag

- GIVEN `PILOT_PROJECT_STATE=off` is set in the shell
- WHEN `GET /settings` is called
- THEN the response includes `projectStateMode: "off"`
- AND `projectStateModePin: "env"` (or equivalent pin indicator) is present

#### Scenario: Settings shows value without pin when env absent

- GIVEN `PILOT_PROJECT_STATE` is not set
- AND stored setting is `"auto"`
- WHEN `GET /settings` is called
- THEN the response includes `projectStateMode: "auto"`
- AND no pin flag is present

---

### Requirement: PATCH /settings accepts projectStateMode

`PATCH /settings` with body `{ "projectStateMode": "<value>" }` MUST:
- Accept `"off"`, `"auto"`, `"always"` and persist the value.
- Return 409 `SHELL_ENV_PINNED` when `PILOT_PROJECT_STATE` is set in the shell env.
- Return 400 with a validation error when the value is not one of the three valid strings.

#### Scenario: Shell-env pin blocks settings patch

- GIVEN `PILOT_PROJECT_STATE` is set in the shell environment
- WHEN `PATCH /settings` is called with `{ "projectStateMode": "always" }`
- THEN the response status is 409
- AND the error code is `SHELL_ENV_PINNED`
- AND the stored setting is unchanged

#### Scenario: Valid patch persists new mode

- GIVEN `PILOT_PROJECT_STATE` is NOT set
- WHEN `PATCH /settings` is called with `{ "projectStateMode": "always" }`
- THEN the response status is 200
- AND `config.projectStateMode` reflects the new value on subsequent reads

#### Scenario: Invalid value returns 400

- GIVEN `PILOT_PROJECT_STATE` is NOT set
- WHEN `PATCH /settings` is called with `{ "projectStateMode": "sometimes" }`
- THEN the response status is 400
- AND the response body contains a validation error naming `projectStateMode`

---

# Docs Specification

## Purpose

Document the new `projectStateMode` flag so operators can configure it without reading source code.

## Requirements

### Requirement: projectStateMode documented in config reference

`README.md` or `docs/CONFIGURATION.md` MUST document `PILOT_PROJECT_STATE` with:
- All valid values and their semantics
- The default value (`auto`)
- Migration note: existing workspaces with `.opencode/` see no behavior change under `auto`

#### Scenario: Docs cover all three modes

- GIVEN the documentation for `PILOT_PROJECT_STATE` exists
- WHEN a reader looks up `off`, `auto`, and `always`
- THEN each value has a one-sentence semantic description
- AND the default is explicitly stated
