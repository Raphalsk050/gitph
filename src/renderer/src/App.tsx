import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import type { ActionDescriptor, GitRef, GraphRow } from '@shared/contracts'
import { ActivityRail, pathName } from './components/ActivityRail'
import { CommitGraph } from './components/CommitGraph'
import { DetailsPanel } from './components/DetailsPanel'
import { EmptyState } from './components/EmptyState'
import { ConfirmDialog, ContextMenu, type ContextMenuItem, ErrorToast, PromptDialog } from './components/Overlays'
import { RefsSidebar } from './components/RefsSidebar'
import { TitleBar } from './components/TitleBar'
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

export function App(): React.JSX.Element {
  const workspace = useWorkspace()
  const [selectedRefName, setSelectedRefName] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
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
    void workspace.selectCommit(ref.displayOid)
  }

  const actionMenuItem = (action: ActionDescriptor): ContextMenuItem => ({
    id: `${action.kind}:${action.refName ?? action.oid ?? ''}`,
    label: action.label,
    detail: action.command,
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
    void workspace.selectCommit(row.commit.oid)
    setDetailsOpen(true)
    const actions = await workspace.listActions(undefined, row.commit.oid)
    setMenu({
      x: event.clientX,
      y: event.clientY,
      title: row.commit.shortOid,
      items: [
        {
          id: 'copy-oid',
          label: 'Copy commit hash',
          detail: row.commit.shortOid,
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
      <div className="app-body">
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
            <CommitGraph
              snapshot={workspace.snapshot}
              selectedOid={workspace.selectedOid}
              loading={workspace.loading}
              onSelect={(oid) => {
                setDetailsOpen(true)
                void workspace.selectCommit(oid)
              }}
              onContextMenu={(event, row) => void openCommitMenu(event, row)}
              onRefresh={() => void workspace.refresh()}
              onFetch={() => void requestFetch()}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
            />
            <DetailsPanel
              snapshot={workspace.snapshot}
              details={workspace.details}
              loading={workspace.loadingDetails}
              open={detailsOpen}
              onCopy={workspace.copyText}
              onClose={() => setDetailsOpen(false)}
            />
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
