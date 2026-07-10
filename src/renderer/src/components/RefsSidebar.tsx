import { useMemo, useState } from 'react'
import {
  Archive,
  ChevronDown,
  Cloud,
  GitBranch,
  MoreHorizontal,
  Search,
  Tag
} from 'lucide-react'
import type { GitRef, RefKind, RepositorySnapshot } from '@shared/contracts'
import { pathName } from './ActivityRail'

interface RefsSidebarProps {
  snapshot: RepositorySnapshot
  selectedRefName: string | null
  open: boolean
  onSelect(ref: GitRef): void
  onContextMenu(event: React.MouseEvent, ref?: GitRef): void
}

const SECTIONS: Array<{ kind: RefKind; label: string; icon: typeof GitBranch }> = [
  { kind: 'local_branch', label: 'Local branches', icon: GitBranch },
  { kind: 'remote_branch', label: 'Remotes', icon: Cloud },
  { kind: 'tag', label: 'Tags', icon: Tag },
  { kind: 'stash', label: 'Stashes', icon: Archive }
]

export function RefsSidebar({
  snapshot,
  selectedRefName,
  open,
  onSelect,
  onContextMenu
}: RefsSidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const grouped = useMemo(() => {
    const map = new Map<RefKind, GitRef[]>()
    for (const ref of snapshot.refs) {
      if (normalizedQuery && !ref.shortName.toLocaleLowerCase().includes(normalizedQuery)) continue
      map.set(ref.kind, [...(map.get(ref.kind) ?? []), ref])
    }
    return map
  }, [normalizedQuery, snapshot.refs])

  const branch = snapshot.status.branchName ?? snapshot.identity.headRef ?? 'Detached HEAD'
  return (
    <aside className={`refs-sidebar${open ? ' mobile-open' : ''}`}>
      <div className="repository-heading">
        <div className="repository-heading-copy">
          <strong>{pathName(snapshot.identity.root)}</strong>
          <span title={snapshot.identity.root}>{snapshot.identity.root}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Repository actions"
          onClick={(event) => onContextMenu(event)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="current-branch-card">
        <div className={`worktree-indicator${snapshot.status.isDirty ? ' dirty' : ''}`} />
        <div>
          <span>Current branch</span>
          <strong>{branch}</strong>
        </div>
        {(snapshot.status.ahead > 0 || snapshot.status.behind > 0) && (
          <small>+{snapshot.status.ahead} −{snapshot.status.behind}</small>
        )}
      </div>

      <label className="sidebar-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter refs"
          aria-label="Filter refs"
        />
      </label>

      <div className="ref-sections">
        {SECTIONS.map(({ kind, label, icon: Icon }) => {
          const refs = grouped.get(kind) ?? []
          return (
            <details className="ref-section" open key={kind}>
              <summary>
                <ChevronDown className="section-chevron" size={14} />
                <Icon size={14} />
                <span>{label}</span>
                <small>{refs.length}</small>
              </summary>
              <div className="ref-list">
                {refs.map((ref) => (
                  <button
                    type="button"
                    className={`ref-item${selectedRefName === ref.fullName ? ' selected' : ''}`}
                    onClick={() => onSelect(ref)}
                    onContextMenu={(event) => onContextMenu(event, ref)}
                    key={ref.fullName}
                  >
                    <span className={`ref-dot ${ref.kind}${ref.isHead ? ' head' : ''}`} />
                    <span title={ref.shortName}>{ref.shortName}</span>
                    {ref.isHead && <em>HEAD</em>}
                  </button>
                ))}
                {refs.length === 0 && <div className="empty-ref-section">No matching refs</div>}
              </div>
            </details>
          )
        })}
      </div>

      {snapshot.status.entries.length > 0 && (
        <div className="worktree-summary">
          <span>Working tree</span>
          <strong>{snapshot.status.entries.length} changed</strong>
        </div>
      )}
    </aside>
  )
}

