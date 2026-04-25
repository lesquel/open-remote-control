// constants.js — Shared magic strings, numbers, and identifiers for the dashboard.
// Import from here instead of inlining literals throughout the codebase.

// ── Status badge CSS class names ──────────────────────────────────────────────
export const STATUS_CLASS = Object.freeze({
  idle:  'idle',
  busy:  'busy',
  error: 'error',
})

// ── Agent badge CSS class names ───────────────────────────────────────────────
export const AGENT_BADGE_CLASS = Object.freeze({
  plan:    'agent-badge--plan',
  build:   'agent-badge--build',
  custom:  'agent-badge--custom',
  dynamic: 'agent-badge--dynamic',
  compact: 'agent-badge--compact',
})

// ── SSE event type strings ────────────────────────────────────────────────────
export const EVENTS = Object.freeze({
  // Session lifecycle
  SESSION_UPDATED:      'session.updated',
  SESSION_CREATED:      'session.created',
  SESSION_DELETED:      'session.deleted',
  // Message lifecycle
  MESSAGE_CREATED:      'message.created',
  MESSAGE_UPDATED:      'message.updated',
  MESSAGE_PART_UPDATED: 'message.part.updated',
  // Incremental text stream — emitted per-token for text/reasoning fields.
  // This is what drives the typewriter effect; MESSAGE_PART_UPDATED only
  // carries snapshots (pending → running → completed) without the delta.
  MESSAGE_PART_DELTA:   'message.part.delta',
  // Permissions
  PERMISSION_REQUESTED: 'permission.requested',
  PERMISSION_RESOLVED:  'permission.resolved',
  // Status / tool
  STATUS_CHANGED:       'status.changed',
  TOOL_COMPLETED:       'tool.completed',
  PILOT_TOOL_COMPLETED: 'pilot.tool.completed',
  TODO_UPDATED:         'todo.updated',
  // References / pilot custom
  REFERENCES_READY:     'references:ready',
  VCS_BRANCH_UPDATED:   'vcs.branch.updated',
  LSP_UPDATED:          'lsp.updated',
  PILOT_SUBAGENT_SPAWNED: 'pilot.subagent.spawned',
})

// ── Resource / size limits ────────────────────────────────────────────────────
export const LIMITS = Object.freeze({
  // Max sessions to load last-message meta for in parallel
  SESSIONS_META_FETCH: 50,
  // Max chars allowed for session title
  TITLE_MAX_CHARS: 200,
  // Max chars allowed in a prompt
  PROMPT_MAX_CHARS: 50000,
  // SSE reconnect backoff: start, max (ms)
  SSE_BACKOFF_MIN_MS: 1000,
  SSE_BACKOFF_MAX_MS: 30000,
  // MCP polling interval (ms)
  MCP_POLL_INTERVAL_MS: 30000,
  // Compact agent badge max label length
  AGENT_BADGE_MAX_CHARS: 12,
  // Bash command preview truncation in tool view
  BASH_CMD_PREVIEW_CHARS: 60,
  // Tool summary max arg preview chars
  TOOL_ARG_PREVIEW_CHARS: 40,
  // Right-panel scroll distance threshold for auto-scroll-to-bottom
  SCROLL_BOTTOM_THRESHOLD_PX: 80,
})

// ── localStorage / sessionStorage keys ───────────────────────────────────────
export const STORAGE_KEYS = Object.freeze({
  FOLDER_COLLAPSED:       'pilot_folder_collapsed',
  ACTIVE_DIRECTORY:       'pilot_active_directory',
  MV_PANELS:              'pilot_mvpanels',
  MV_ACTIVE:              'pilot_mvactive',
  SUBAGENTS_COLLAPSED:    'pilot_subagents_collapsed',
  RIGHT_PANEL_COLLAPSED:  'pilot_rp_collapsed_',
  // Feature: cost tracking
  COST_HISTORY:           'pilot_cost_history',
  COST_BUDGET_WARNED:     'pilot_cost_budget_warned',
  // Feature: pinned TODOs
  PINNED_TODOS:           'pilot_pinned_todos',
  // Feature: project tabs (multi-project simultaneous)
  PROJECT_TABS:           'pilot_project_tabs',
  ACTIVE_PROJECT_ID:      'pilot_active_project_id',
})

// ── Color / style constants ───────────────────────────────────────────────────
export const AGENT_COLOR = Object.freeze({
  // HSL parameters for deterministic agent color generation
  SATURATION: 55,
  LIGHTNESS:  65,
})
