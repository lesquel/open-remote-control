// Type declarations for the subset of state.js exports consumed by .test.ts files.
// state.js is browser vanilla JS — kept that way because the dashboard ships
// .js to the browser as static files. This .d.ts gives TypeScript visibility
// for the symbols our tests touch without forcing a build step.

export type ProjectTab = {
  id: string
  directory: string | null
  label: string
  sessions: Record<string, unknown>
  statuses: Record<string, string>
  sessionMeta: Record<string, { lastModel?: string; lastProvider?: string; lastAgent?: string }>
  activeSession: string | null
  loaded: boolean
}

export type ProjectRequestTicket = {
  scope: string
  generation: number
  projectId: string | null
  directory: string | null
  signal: AbortSignal
}

export function getActiveDirectory(): string | null
export function setActiveDirectory(dir: string | null | undefined): void
export function beginProjectRequest(scope?: string): ProjectRequestTicket
export function isCurrentProjectRequest(ticket: ProjectRequestTicket): boolean
export function finishProjectRequest(ticket: ProjectRequestTicket): void
export function abortProjectRequests(): void
export function findProjectTabByDirectory(directory: string | null | undefined): ProjectTab | null
export function getProjectTabs(): ProjectTab[]
export function getActiveProjectTab(): ProjectTab | null
export function addProjectTab(directory: string | null | undefined, label?: string | null): ProjectTab
export function rebindProjectTab(id: string, directory: string, label?: string | null): ProjectTab | null
export function removeProjectTab(id: string): void
export function switchProjectTab(id: string): void
export function setProjectTabLabel(id: string, label: string): void
export function getState(): Record<string, unknown>
export function setState(patch: Record<string, unknown>): void
