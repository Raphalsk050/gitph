import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  List,
  ListTree,
  Minus,
  Plus,
  RotateCcw,
  X
} from 'lucide-react'
import type {
  CommitRequest,
  RepositorySnapshot,
  StatusEntry,
  WorkingDiffRequest
} from '@shared/contracts'
import { basename, groupByFolder, KIND_LABEL, kindFromStatus, type ChangeKind } from '../file-status'
import { DiffView } from './DiffView'

interface WorkingChangesPanelProps {
  snapshot: RepositorySnapshot
  busy: boolean
  open: boolean
  onStage(paths: string[]): Promise<boolean>
  onUnstage(paths: string[]): Promise<boolean>
  onDiscard(paths: string[]): Promise<boolean>
  onCommit(request: CommitRequest): Promise<boolean>
  loadDiff(request: WorkingDiffRequest): Promise<string | null>
  onClose(): void
}

type Section = 'staged' | 'unstaged'
type ViewMode = 'path' | 'tree'

interface ChangeItem {
  entry: StatusEntry
  section: Section
  /** Single-letter status shown in the badge (A, M, D, R, U). */
  letter: string
  kind: ChangeKind
  untracked: boolean
}

export function WorkingChangesPanel({
  snapshot,
  busy,
  open,
  onStage,
  onUnstage,
  onDiscard,
  onCommit,
  loadDiff,
  onClose
}: WorkingChangesPanelProps): React.JSX.Element {
  const [view, setView] = useState<ViewMode>('path')
  const [active, setActive] = useState<{ path: string; section: Section; untracked: boolean } | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<{ paths: string[]; label: string } | null>(null)
  const diffRequest = useRef(0)

  const { staged, unstaged } = useMemo(() => splitEntries(snapshot.status.entries), [snapshot.status.entries])
  const branch = snapshot.status.branchName ?? 'detached HEAD'
  const total = staged.length + unstaged.length

  // If the selected file leaves the working tree (staged, discarded, committed),
  // drop back to the list rather than showing a stale diff.
  useEffect(() => {
    if (!active) return
    const list = active.section === 'staged' ? staged : unstaged
    if (!list.some((item) => item.entry.path === active.path)) setActive(null)
  }, [active, staged, unstaged])

  useEffect(() => {
    if (!active) {
      setDiff(null)
      return
    }
    const request = ++diffRequest.current
    setDiffLoading(true)
    void loadDiff({ path: active.path, staged: active.section === 'staged', untracked: active.untracked }).then(
      (patch) => {
        if (request !== diffRequest.current) return
        setDiffLoading(false)
        setDiff(patch ?? '')
      }
    )
  }, [active, loadDiff])

  const unstagedActivePath = active && active.section === 'unstaged' ? active.path : null
  const stagedActivePath = active && active.section === 'staged' ? active.path : null
  const canCommit = summary.trim().length > 0 && !busy && (staged.length > 0 || unstaged.length > 0 || amend)
  const commitLabel = staged.length === 0 && unstaged.length > 0 ? 'Stage all & Commit' : 'Commit'

  const runCommit = async (): Promise<void> => {
    const ok = await onCommit({
      summary: summary.trim(),
      description: description.trim() || undefined,
      amend,
      stageAll: staged.length === 0 && unstaged.length > 0
    })
    if (ok) {
      setSummary('')
      setDescription('')
      setAmend(false)
    }
  }

  const askDiscard = (paths: string[], label: string): void => setConfirmDiscard({ paths, label })

  return (
    <aside className={`details-panel working-panel${open ? ' mobile-open' : ''}`}>
      <button type="button" className="detail-close" aria-label="Close changes" onClick={onClose}>
        <X size={18} />
      </button>

      {active ? (
        <div className="working-diff" key={`${active.section}:${active.path}`}>
          <header className="working-diff-header">
            <button type="button" className="back-button" onClick={() => setActive(null)}>
              <ChevronLeft size={16} /> Changes
            </button>
            <FileActions
              item={(active.section === 'staged' ? staged : unstaged).find((item) => item.entry.path === active.path)}
              busy={busy}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={askDiscard}
            />
          </header>
          <div className="working-diff-path" title={active.path}>{active.path}</div>
          <div className="diff-pane">
            {diffLoading ? (
              <div className="empty-detail">Loading diff…</div>
            ) : diff ? (
              <DiffView patch={diff} />
            ) : (
              <div className="empty-detail">No textual changes to display.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="working-content">
          <header className="working-header">
            <div>
              <span className="detail-eyebrow"><GitCommitHorizontal size={14} /> Working changes</span>
              <h2>{total} {total === 1 ? 'change' : 'changes'} on <em>{branch}</em></h2>
            </div>
            <div className="segmented view-toggle" role="group" aria-label="Group files">
              <button type="button" className={view === 'path' ? 'active' : ''} onClick={() => setView('path')} title="Flat list">
                <List size={14} /> Path
              </button>
              <button type="button" className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')} title="Group by folder">
                <ListTree size={14} /> Tree
              </button>
            </div>
          </header>

          <div className="working-lists">
            <ChangeSection
              title="Unstaged"
              items={unstaged}
              view={view}
              busy={busy}
              activePath={unstagedActivePath}
              primaryLabel="Stage"
              onPrimary={(paths) => void onStage(paths)}
              onDiscard={askDiscard}
              onOpen={(item) => setActive({ path: item.entry.path, section: 'unstaged', untracked: item.untracked })}
              bulk={
                unstaged.length > 0
                  ? { label: 'Stage all', run: () => void onStage(unstaged.map((item) => item.entry.path)) }
                  : null
              }
            />
            <ChangeSection
              title="Staged"
              items={staged}
              view={view}
              busy={busy}
              activePath={stagedActivePath}
              primaryLabel="Unstage"
              onPrimary={(paths) => void onUnstage(paths)}
              onDiscard={askDiscard}
              onOpen={(item) => setActive({ path: item.entry.path, section: 'staged', untracked: false })}
              bulk={
                staged.length > 0
                  ? { label: 'Unstage all', run: () => void onUnstage(staged.map((item) => item.entry.path)) }
                  : null
              }
            />
            {total === 0 && (
              <div className="working-empty">
                <GitCommitHorizontal size={30} />
                <strong>No uncommitted changes</strong>
                <span>Your working tree is clean.</span>
              </div>
            )}
          </div>

          <form
            className="commit-box"
            onSubmit={(event) => {
              event.preventDefault()
              if (canCommit) void runCommit()
            }}
          >
            <label className="amend-toggle">
              <input type="checkbox" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
              Amend previous commit
            </label>
            <input
              className="commit-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Commit summary"
              aria-label="Commit summary"
              spellCheck={false}
            />
            <textarea
              className="commit-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
              aria-label="Commit description"
              rows={3}
              spellCheck={false}
            />
            <button type="submit" className="primary-button commit-submit" disabled={!canCommit}>
              <GitCommitHorizontal size={15} /> {commitLabel}
            </button>
          </form>
        </div>
      )}

      {confirmDiscard && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setConfirmDiscard(null)
          }}
        >
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title">
            <button type="button" className="dialog-close" aria-label="Close" disabled={busy} onClick={() => setConfirmDiscard(null)}>
              <X size={18} />
            </button>
            <span className="confirm-icon high-risk"><RotateCcw size={22} /></span>
            <div>
              <span className="dialog-eyebrow">High-impact action</span>
              <h2 id="discard-title">Discard changes</h2>
            </div>
            <p>
              This permanently reverts <strong>{confirmDiscard.label}</strong> to the last committed state. Discarded
              changes cannot be recovered.
            </p>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDiscard(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button danger"
                disabled={busy}
                onClick={async () => {
                  const ok = await onDiscard(confirmDiscard.paths)
                  if (ok) setConfirmDiscard(null)
                }}
              >
                {busy ? 'Discarding…' : 'Discard'}
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}

interface ChangeSectionProps {
  title: string
  items: ChangeItem[]
  view: ViewMode
  busy: boolean
  activePath: string | null
  primaryLabel: string
  onPrimary(paths: string[]): void
  onDiscard(paths: string[], label: string): void
  onOpen(item: ChangeItem): void
  bulk: { label: string; run(): void } | null
}

function ChangeSection({
  title,
  items,
  view,
  busy,
  activePath,
  primaryLabel,
  onPrimary,
  onDiscard,
  onOpen,
  bulk
}: ChangeSectionProps): React.JSX.Element {
  const groups = useMemo(
    () => (view === 'tree' ? groupByFolder(items, (item) => item.entry.path) : null),
    [view, items]
  )
  return (
    <section className="change-section">
      <header className="change-section-header">
        <span>{title} <em>{items.length}</em></span>
        {bulk && (
          <button type="button" className="link-button" disabled={busy} onClick={bulk.run}>
            {bulk.label}
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <div className="change-empty">Nothing here.</div>
      ) : groups ? (
        groups.map((group) => (
          <div className="change-group" key={group.folder}>
            {group.folder && <div className="change-group-folder" title={group.folder}>{group.folder}</div>}
            {group.items.map((item) => (
              <FileRow
                key={item.entry.path}
                item={item}
                showFolder={false}
                active={activePath === item.entry.path}
                busy={busy}
                primaryLabel={primaryLabel}
                onPrimary={onPrimary}
                onDiscard={onDiscard}
                onOpen={onOpen}
              />
            ))}
          </div>
        ))
      ) : (
        items.map((item) => (
          <FileRow
            key={item.entry.path}
            item={item}
            showFolder
            active={activePath === item.entry.path}
            busy={busy}
            primaryLabel={primaryLabel}
            onPrimary={onPrimary}
            onDiscard={onDiscard}
            onOpen={onOpen}
          />
        ))
      )}
    </section>
  )
}

interface FileRowProps {
  item: ChangeItem
  showFolder: boolean
  active: boolean
  busy: boolean
  primaryLabel: string
  onPrimary(paths: string[]): void
  onDiscard(paths: string[], label: string): void
  onOpen(item: ChangeItem): void
}

function FileRow({ item, showFolder, active, busy, primaryLabel, onPrimary, onDiscard, onOpen }: FileRowProps): React.JSX.Element {
  const name = basename(item.entry.path)
  const folder = item.entry.path.slice(0, item.entry.path.length - name.length)
  return (
    <div className={`change-file${active ? ' active' : ''}`}>
      <button type="button" className="change-file-open" onClick={() => onOpen(item)} title={item.entry.path}>
        <span className={`file-status kind-${item.kind}`} title={KIND_LABEL[item.kind]}>{item.letter}</span>
        <span className="change-file-name">
          {item.entry.originalPath && <em>{basename(item.entry.originalPath)} → </em>}
          {name}
        </span>
        {showFolder && folder && <span className="change-file-folder">{folder.replace(/\/$/u, '')}</span>}
        <ChevronRight className="change-file-chevron" size={14} />
      </button>
      <div className="change-file-actions">
        <button
          type="button"
          className="ghost-action"
          disabled={busy}
          title={`${primaryLabel} file`}
          aria-label={`${primaryLabel} ${item.entry.path}`}
          onClick={() => onPrimary([item.entry.path])}
        >
          {primaryLabel === 'Stage' ? <Plus size={15} /> : <Minus size={15} />}
        </button>
        <button
          type="button"
          className="ghost-action danger"
          disabled={busy}
          title="Discard file"
          aria-label={`Discard ${item.entry.path}`}
          onClick={() => onDiscard([item.entry.path], name)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  )
}

function FileActions({
  item,
  busy,
  onStage,
  onUnstage,
  onDiscard
}: {
  item: ChangeItem | undefined
  busy: boolean
  onStage(paths: string[]): Promise<boolean>
  onUnstage(paths: string[]): Promise<boolean>
  onDiscard(paths: string[], label: string): void
}): React.JSX.Element | null {
  if (!item) return null
  const path = item.entry.path
  return (
    <div className="working-diff-actions">
      {item.section === 'staged' ? (
        <button type="button" className="chip-button" disabled={busy} onClick={() => void onUnstage([path])}>
          <Minus size={14} /> Unstage
        </button>
      ) : (
        <button type="button" className="chip-button" disabled={busy} onClick={() => void onStage([path])}>
          <Plus size={14} /> Stage
        </button>
      )}
      <button type="button" className="chip-button danger" disabled={busy} onClick={() => onDiscard([path], basename(path))}>
        <RotateCcw size={13} /> Discard
      </button>
    </div>
  )
}

function splitEntries(entries: readonly StatusEntry[]): { staged: ChangeItem[]; unstaged: ChangeItem[] } {
  const staged: ChangeItem[] = []
  const unstaged: ChangeItem[] = []
  for (const entry of entries) {
    const untracked = entry.indexStatus === '?' && entry.worktreeStatus === '?'
    if (untracked) {
      unstaged.push({ entry, section: 'unstaged', letter: 'A', kind: 'new', untracked: true })
      continue
    }
    if (entry.indexStatus === 'U' || entry.worktreeStatus === 'U') {
      unstaged.push({ entry, section: 'unstaged', letter: 'U', kind: 'conflicted', untracked: false })
      continue
    }
    if (isChange(entry.indexStatus)) {
      staged.push({
        entry,
        section: 'staged',
        letter: entry.indexStatus,
        kind: kindFromStatus(entry.indexStatus),
        untracked: false
      })
    }
    if (isChange(entry.worktreeStatus)) {
      unstaged.push({
        entry,
        section: 'unstaged',
        letter: entry.worktreeStatus,
        kind: kindFromStatus(entry.worktreeStatus),
        untracked: false
      })
    }
  }
  return { staged, unstaged }
}

// git status --porcelain=v2 marks an unchanged side with "." (not a space).
function isChange(letter: string): boolean {
  return letter !== '.' && letter !== ' ' && letter !== '?'
}
