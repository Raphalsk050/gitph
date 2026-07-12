import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Cherry,
  Copy,
  FolderOpen,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  RefreshCw,
  RotateCcw,
  Spline,
  Tag,
  Trash2,
  Undo2,
  type LucideIcon
} from 'lucide-react'
import type { ActionDescriptor, GitActionKind, GitRef, GraphRow } from '@shared/contracts'
import { ActivityRail, pathName } from './components/ActivityRail'
import { CommitGraph } from './components/CommitGraph'
import { DetailsPanel } from './components/DetailsPanel'
import { EmptyState } from './components/EmptyState'
import { ConfirmDialog, ContextMenu, type ContextMenuItem, ErrorToast, PromptDialog } from './components/Overlays'
import { RefsSidebar } from './components/RefsSidebar'
import { TitleBar } from './components/TitleBar'
import { WorkingChangesPanel } from './components/WorkingChangesPanel'
import { useWorkspace } from './hooks/useWorkspace'

interface MenuState {
  x: number
  y: number
  title: string
  items: ContextMenuItem[]
}

interface PendingAction {
  action: ActionDescriptor
  name?: string
}

/** Lucide glyph per action, so the menu reads by intent rather than by text alone. */
const ACTION_ICONS: Record<GitActionKind, LucideIcon> = {
  fetch_all: RefreshCw,
  fetch_remote: ArrowDownToLine,
  pull_ff: ArrowDownToLine,
  push_head: ArrowUpFromLine,
  switch_branch: ArrowRightLeft,
  track_remote: GitBranchPlus,
  merge_branch: GitMerge,
  rebase_onto_branch: Spline,
  delete_branch: Trash2,
  checkout_tag: Tag,
  delete_tag: Trash2,
  checkout_commit: GitCommitHorizontal,
  create_branch: GitBranch,
  create_tag: Tag,
  cherry_pick: Cherry,
  revert_commit: Undo2,
  reset_soft: RotateCcw,
  reset_mixed: RotateCcw,
  reset_hard: AlertTriangle
}

/** Section header a commit action falls under; other kinds stay ungrouped. */
const ACTION_GROUPS: Partial<Record<GitActionKind, string>> = {
  create_branch: 'Create',
  create_tag: 'Create',
  checkout_commit: 'Create',
  cherry_pick: 'Apply',
  revert_commit: 'Apply',
  reset_soft: 'Reset branch',
  reset_mixed: 'Reset branch',
  reset_hard: 'Reset branch'
}

const RAIL_WIDTH = 68
const PANEL_LIMITS = {
  sidebar: { min: 200, max: 420, fallback: 264 },
  details: { min: 320, max: 640, fallback: 410 }
} as const

type PanelKind = keyof typeof PANEL_LIMITS

function readPanelWidth(panel: PanelKind): number {
  const limits = PANEL_LIMITS[panel]
  const stored = Number(window.localStorage.getItem(`gitph:panel:${panel}`))
  if (!Number.isFinite(stored) || stored === 0) return limits.fallback
  return Math.min(limits.max, Math.max(limits.min, stored))
}

/** Drag state and persistence for the two vertical panel splitters. */
function usePanelWidths(): {
  sidebarWidth: number
  detailsWidth: number
  startResize(panel: PanelKind, event: React.PointerEvent<HTMLDivElement>): void
} {
  const [widths, setWidths] = useState(() => ({
    sidebar: readPanelWidth('sidebar'),
    details: readPanelWidth('details')
  }))

  const startResize = useCallback((panel: PanelKind, event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const limits = PANEL_LIMITS[panel]
    // Pointer capture keeps the drag alive even when the cursor leaves the
    // window, so a release outside cannot strand the resize state.
    const splitter = event.currentTarget
    splitter.setPointerCapture(event.pointerId)
    document.body.classList.add('panel-resizing')

    const onMove = (move: PointerEvent): void => {
      const raw = panel === 'sidebar' ? move.clientX - RAIL_WIDTH : window.innerWidth - move.clientX
      const width = Math.min(limits.max, Math.max(limits.min, raw))
      setWidths((current) => (current[panel] === width ? current : { ...current, [panel]: width }))
    }
    const finish = (): void => {
      document.body.classList.remove('panel-resizing')
      splitter.removeEventListener('pointermove', onMove)
      splitter.removeEventListener('pointerup', finish)
      splitter.removeEventListener('pointercancel', finish)
      setWidths((current) => {
        window.localStorage.setItem(`gitph:panel:${panel}`, String(current[panel]))
        return current
      })
    }
    splitter.addEventListener('pointermove', onMove)
    splitter.addEventListener('pointerup', finish)
    splitter.addEventListener('pointercancel', finish)
  }, [])

  return { sidebarWidth: widths.sidebar, detailsWidth: widths.details, startResize }
}

export function App(): React.JSX.Element {
  const workspace = useWorkspace()
  const { sidebarWidth, detailsWidth, startResize } = usePanelWidths()
  const [selectedRefName, setSelectedRefName] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [workingSelected, setWorkingSelected] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmation, setConfirmation] = useState<PendingAction | null>(null)
  const [namePrompt, setNamePrompt] = useState<ActionDescriptor | null>(null)

  const repositoryName = workspace.snapshot ? pathName(workspace.snapshot.identity.root) : null
  const currentRepository = workspace.snapshot?.identity.root ?? null

  useEffect(() => {
    const head = workspace.snapshot?.refs.find((ref) => ref.isHead)
    setSelectedRefName(head?.fullName ?? null)
  }, [workspace.snapshot?.identity.root, workspace.snapshot?.refs])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'o') {
        event.preventDefault()
        void workspace.openRepository()
      } else if (event.key === 'F5') {
        event.preventDefault()
        void workspace.refresh()
      } else if (event.key === 'Escape') {
        setMenu(null)
        setNamePrompt(null)
        if (!workspace.loading) setConfirmation(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspace.loading, workspace.openRepository, workspace.refresh])

  const statusSummary = useMemo(() => {
    if (!workspace.snapshot) return 'No repository open'
    return `${workspace.snapshot.graph.rows.length} commits · ${workspace.snapshot.status.entries.length} changed`
  }, [workspace.snapshot])

  const selectRef = (ref: GitRef): void => {
    setSelectedRefName(ref.fullName)
    setSidebarOpen(false)
    setDetailsOpen(true)
    setWorkingSelected(false)
    void workspace.selectCommit(ref.displayOid)
  }

  const selectCommit = (oid: string): void => {
    setDetailsOpen(true)
    setWorkingSelected(false)
    void workspace.selectCommit(oid)
  }

  const workingChanges = workspace.snapshot?.status.entries.length ?? 0

  const actionMenuItem = (action: ActionDescriptor): ContextMenuItem => ({
    id: `${action.kind}:${action.refName ?? action.oid ?? ''}`,
    label: action.label,
    group: ACTION_GROUPS[action.kind],
    icon: ACTION_ICONS[action.kind],
    badge: action.riskLevel === 'high' ? 'High impact' : undefined,
    danger: action.kind === 'reset_hard',
    onSelect: () => {
      if (action.requiresName) setNamePrompt(action)
      else setConfirmation({ action })
    }
  })

  const openRefMenu = async (event: React.MouseEvent, ref?: GitRef): Promise<void> => {
    event.preventDefault()
    if (ref) setSelectedRefName(ref.fullName)
    const actions = await workspace.listActions(ref?.fullName)
    const items: ContextMenuItem[] = actions.map(actionMenuItem)
    items.push({
      id: 'open-repository',
      label: 'Open repository…',
      icon: FolderOpen,
      detail: 'Ctrl + O',
      onSelect: () => void workspace.openRepository()
    })
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: ref ? ref.shortName : 'Repository actions',
      items
    })
  }

  const openCommitMenu = async (event: React.MouseEvent, row: GraphRow): Promise<void> => {
    event.preventDefault()
    setWorkingSelected(false)
    void workspace.selectCommit(row.commit.oid)
    setDetailsOpen(true)
    const actions = await workspace.listActions(undefined, row.commit.oid)
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: row.commit.subject,
      items: [
        {
          id: 'copy-oid',
          label: 'Copy commit hash',
          icon: Copy,
          onSelect: () => void workspace.copyText(row.commit.oid)
        },
        ...actions.map(actionMenuItem)
      ]
    })
  }

  const requestFetch = async (): Promise<void> => {
    const action = (await workspace.listActions()).find((candidate) => candidate.kind === 'fetch_all')
    if (action) setConfirmation({ action })
  }

  const confirmAction = async (): Promise<void> => {
    if (!confirmation) return
    const completed = await workspace.runAction(confirmation.action, confirmation.name)
    if (completed) setConfirmation(null)
  }

  return (
    <div className="app-shell">
      <TitleBar repositoryName={repositoryName} />
      <div
        className="app-body"
        style={{ '--sidebar-w': `${sidebarWidth}px`, '--details-w': `${detailsWidth}px` } as React.CSSProperties}
      >
        <ActivityRail
          currentRepository={currentRepository}
          recentRepositories={workspace.recentRepositories}
          disabled={workspace.loading}
          onOpen={(path) => void workspace.openRepository(path)}
        />
        {workspace.snapshot ? (
          <>
            <RefsSidebar
              snapshot={workspace.snapshot}
              selectedRefName={selectedRefName}
              open={sidebarOpen}
              onSelect={selectRef}
              onContextMenu={(event, ref) => void openRefMenu(event, ref)}
            />
            <div
              className="panel-splitter splitter-sidebar"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize branches panel"
              onPointerDown={(event) => startResize('sidebar', event)}
            />
            <CommitGraph
              snapshot={workspace.snapshot}
              selectedOid={workspace.selectedOid}
              loading={workspace.loading}
              workingChanges={workingChanges}
              workingSelected={workingSelected}
              onSelectWorking={() => {
                setDetailsOpen(true)
                setWorkingSelected(true)
              }}
              onSelect={selectCommit}
              onContextMenu={(event, row) => void openCommitMenu(event, row)}
              onRefresh={() => void workspace.refresh()}
              onFetch={() => void requestFetch()}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
            />
            <div
              className="panel-splitter splitter-details"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize details panel"
              onPointerDown={(event) => startResize('details', event)}
            />
            {workingSelected ? (
              <WorkingChangesPanel
                snapshot={workspace.snapshot}
                busy={workspace.loading}
                open={detailsOpen}
                onStage={workspace.stageEntries}
                onUnstage={workspace.unstageEntries}
                onDiscard={workspace.discardEntries}
                onCommit={async (request) => {
                  const ok = await workspace.commitChanges(request)
                  if (ok) setWorkingSelected(false)
                  return ok
                }}
                loadDiff={workspace.loadWorkingDiff}
                onClose={() => setDetailsOpen(false)}
              />
            ) : (
              <DetailsPanel
                snapshot={workspace.snapshot}
                details={workspace.details}
                loading={workspace.loadingDetails}
                open={detailsOpen}
                onCopy={workspace.copyText}
                onClose={() => setDetailsOpen(false)}
              />
            )}
          </>
        ) : (
          <EmptyState loading={workspace.loading} onOpen={() => void workspace.openRepository()} />
        )}
      </div>
      <footer className="statusbar">
        <span className={`status-dot${workspace.loading ? ' busy' : ''}`} />
        <span className="status-message">{workspace.status}</span>
        {currentRepository && <span className="status-path" title={currentRepository}><FolderOpen size={12} /> {currentRepository}</span>}
        <span className="status-summary">{statusSummary}</span>
        <span className="status-shortcut"><RefreshCw size={12} /> F5 refresh</span>
      </footer>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {namePrompt && (
        <PromptDialog
          action={namePrompt}
          onSubmit={(name) => {
            setNamePrompt(null)
            setConfirmation({ action: namePrompt, name })
          }}
          onClose={() => setNamePrompt(null)}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          action={confirmation.action}
          name={confirmation.name}
          busy={workspace.loading}
          onConfirm={() => void confirmAction()}
          onClose={() => setConfirmation(null)}
        />
      )}
      {workspace.error && <ErrorToast message={workspace.error} onClose={workspace.clearError} />}
      <span className="sr-only" aria-live="polite">{workspace.status}</span>
    </div>
  )
}
