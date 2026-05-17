// Type declarations for the subset of constants.js exports consumed by .test.ts files.
// constants.js is browser vanilla JS — kept that way because the dashboard ships
// .js to the browser as static files. This .d.ts gives TypeScript visibility
// for the symbols our tests touch without forcing a build step.

export declare const EVENTS: {
  readonly SESSION_UPDATED: string
  readonly SESSION_CREATED: string
  readonly SESSION_DELETED: string
  readonly MESSAGE_CREATED: string
  readonly MESSAGE_UPDATED: string
  readonly MESSAGE_PART_UPDATED: string
  readonly MESSAGE_PART_DELTA: string
  readonly PERMISSION_REQUESTED: string
  readonly PERMISSION_RESOLVED: string
  readonly PERMISSION_PENDING_PILOT: string
  readonly PERMISSION_RESOLVED_PILOT: string
  readonly STATUS_CHANGED: string
  readonly TOOL_COMPLETED: string
  readonly PILOT_TOOL_COMPLETED: string
  readonly TODO_UPDATED: string
  readonly REFERENCES_READY: string
  readonly VCS_BRANCH_UPDATED: string
  readonly LSP_UPDATED: string
  readonly PILOT_SUBAGENT_SPAWNED: string
}

export declare const LIMITS: {
  readonly SESSIONS_META_FETCH: number
  readonly TITLE_MAX_CHARS: number
  readonly PROMPT_MAX_CHARS: number
  readonly SSE_BACKOFF_MIN_MS: number
  readonly SSE_BACKOFF_MAX_MS: number
  readonly MCP_POLL_INTERVAL_MS: number
  readonly AGENT_BADGE_MAX_CHARS: number
  readonly BASH_CMD_PREVIEW_CHARS: number
  readonly TOOL_ARG_PREVIEW_CHARS: number
  readonly SCROLL_BOTTOM_THRESHOLD_PX: number
}

export declare const STATUS_CLASS: {
  readonly idle: string
  readonly busy: string
  readonly error: string
}

export declare const AGENT_BADGE_CLASS: {
  readonly plan: string
  readonly build: string
  readonly custom: string
  readonly dynamic: string
  readonly compact: string
}

export declare const STORAGE_KEYS: {
  readonly FOLDER_COLLAPSED: string
  readonly ACTIVE_DIRECTORY: string
  readonly MV_PANELS: string
  readonly MV_ACTIVE: string
  readonly SUBAGENTS_COLLAPSED: string
  readonly RIGHT_PANEL_COLLAPSED: string
  readonly COST_HISTORY: string
  readonly COST_BUDGET_WARNED: string
  readonly PINNED_TODOS: string
  readonly PROJECT_TABS: string
  readonly ACTIVE_PROJECT_ID: string
}

export declare const AGENT_COLOR: {
  readonly SATURATION: number
  readonly LIGHTNESS: number
}
