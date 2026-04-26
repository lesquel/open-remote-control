export type ResolveDirResult =
  | { ok: true; dir: string }
  | { ok: false; reason: string }

export type ProjectTabLike = {
  id: string
  directory: string | null
  label: string
}

export type TabAction =
  | { action: "activate"; tabId: string }
  | { action: "create"; dir: string; label: string }

export function resolveDirFromHash(hash: string): ResolveDirResult

export function resolveTabAction(
  dir: string,
  tabs: ReadonlyArray<ProjectTabLike>,
): TabAction
