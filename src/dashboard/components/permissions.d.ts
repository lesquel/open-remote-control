export function loadPermissions(): Promise<boolean>
export function showNextPerm(): void
export function initPermissions(): void
export function handlePermissionRequested(data: Record<string, unknown> | null | undefined): void
export function handlePermissionResolved(data: Record<string, unknown> | string | null | undefined): void
