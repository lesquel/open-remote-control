function absoluteDirectory(value) {
  if (typeof value !== 'string') return null
  const directory = value.trim()
  if (!directory || (!directory.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(directory))) return null
  return directory
}

export function currentProjectDirectory(project) {
  if (!project || typeof project !== 'object') return null
  return absoluteDirectory(project.worktree)
    ?? absoluteDirectory(project.path)
    ?? absoluteDirectory(project.root)
}

export function projectLabel(project, directory) {
  if (project && typeof project === 'object' && typeof project.name === 'string' && project.name.trim()) {
    return project.name.trim()
  }
  const parts = String(directory ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? 'project'
}
