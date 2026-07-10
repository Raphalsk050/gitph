import { FolderGit2, Plus } from 'lucide-react'

interface ActivityRailProps {
  currentRepository: string | null
  recentRepositories: string[]
  disabled: boolean
  onOpen(path?: string): void
}

export function ActivityRail({
  currentRepository,
  recentRepositories,
  disabled,
  onOpen
}: ActivityRailProps): React.JSX.Element {
  return (
    <aside className="activity-rail" aria-label="Recent repositories">
      <button type="button" className="brand-orb" aria-label="Gitph home">
        <FolderGit2 size={23} />
      </button>
      <span className="rail-separator" />
      <div className="recent-repositories">
        {recentRepositories.map((path) => {
          const name = pathName(path)
          const active = normalizePath(path) === normalizePath(currentRepository ?? '')
          return (
            <button
              type="button"
              className={`repository-orb${active ? ' active' : ''}`}
              aria-label={`Open ${name}`}
              title={path}
              disabled={disabled || active}
              onClick={() => onOpen(path)}
              key={path}
            >
              <span>{initials(name)}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="add-repository"
        aria-label="Open another repository"
        title="Open repository"
        disabled={disabled}
        onClick={() => onOpen()}
      >
        <Plus size={21} />
      </button>
    </aside>
  )
}

export function pathName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

function initials(name: string): string {
  const parts = name.replace(/[^a-z0-9]+/giu, ' ').trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return 'G'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, '/').toLocaleLowerCase()
}

