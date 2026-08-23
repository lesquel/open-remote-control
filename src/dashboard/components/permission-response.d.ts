export type PermissionItem = { id?: string; permissionID?: string }

export declare function createPermissionResponder(deps: {
  getPending: () => PermissionItem[]
  setPending: (pending: PermissionItem[]) => void
  send: (id: string, action: string) => Promise<unknown>
  refresh: () => Promise<unknown>
  render: () => void
  setBusy: (busy: boolean) => void
  onError: () => void
}): (action: string) => Promise<boolean>
