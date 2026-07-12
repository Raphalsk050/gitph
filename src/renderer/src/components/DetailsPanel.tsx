import { useEffect, useState } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, GitCommitHorizontal, List, ListTree, X } from 'lucide-react'
import type { ChangedFile, CommitDetails, RepositorySnapshot } from '@shared/contracts'
import { basename, folderOf, groupByFolder, KIND_LABEL, KIND_LETTER, KIND_ORDER, kindFromStatus } from '../file-status'
import { DiffView } from './DiffView'

interface DetailsPanelProps {
  snapshot: RepositorySnapshot
  details: CommitDetails | null
  loading: boolean
  open: boolean
  onCopy(text: string): Promise<boolean>
  onClose(): void
}

type DetailTab = 'files' | 'diff'
type ViewMode = 'path' | 'tree'

export function DetailsPanel({
  snapshot,
  details,
  loading,
  open,
  onCopy,
  onClose
}: DetailsPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DetailTab>('files')
  const [view, setView] = useState<ViewMode>('path')
  const [copied, setCopied] = useState(false)
  // When a file is clicked in the list, jump to the Patch tab and scroll its
  // diff card into view.
  const [focusPath, setFocusPath] = useState<string | null>(null)

  useEffect(() => {
    setTab('files')
    setCopied(false)
    setFocusPath(null)
  }, [details?.summary.oid])

  useEffect(() => {
    if (tab !== 'diff' || focusPath === null) return
    const frame = window.requestAnimationFrame(() => {
      const card = document.querySelector(`.detail-content .diff-file[data-diff-file="${CSS.escape(focusPath)}"]`)
      card?.scrollIntoView({ block: 'start' })
      setFocusPath(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [tab, focusPath])

  const openFile = (file: ChangedFile): void => {
    setFocusPath(file.path)
    setTab('diff')
  }

  const copyOid = async (): Promise<void> => {
    if (!details || !(await onCopy(details.summary.oid))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <aside className={`details-panel${open ? ' mobile-open' : ''}`}>
      <button type="button" className="detail-close" aria-label="Close details" onClick={onClose}>
        <X size={18} />
      </button>
      {loading ? (
        <DetailsSkeleton />
      ) : details ? (
        <div className="detail-content" key={details.summary.oid}>
          <div className="detail-header">
            <span className="detail-eyebrow"><GitCommitHorizontal size={14} /> Commit details</span>
            <h2>{details.summary.subject || '(no subject)'}</h2>
            <button type="button" className="hash-button" onClick={() => void copyOid()}>
              <code>{details.summary.shortOid}</code>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <div className="detail-author-row">
              <span className="author-avatar">{authorInitials(details.summary.author)}</span>
              <div>
                <strong>{details.summary.author}</strong>
                <span>{new Date(details.summary.commitTime * 1000).toLocaleString()}</span>
              </div>
            </div>
            {details.summary.parents.length > 0 && (
              <div className="parent-row">
                <span>Parents</span>
                {details.summary.parents.map((parent) => <code key={parent}>{parent.slice(0, 8)}</code>)}
              </div>
            )}
            {details.body && details.body !== details.summary.subject && <p className="commit-body">{details.body}</p>}
          </div>
          <div className="detail-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
              Files <span>{details.changedFiles.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'diff'} className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>
              Patch
            </button>
            <button
              type="button"
              className="icon-button diff-pop-out"
              aria-label="Open patch in a new window"
              title="Open patch in a new window"
              onClick={() => void window.gitph.openDiffWindow(details.summary.oid)}
            >
              <ExternalLink size={14} />
            </button>
          </div>
          {tab === 'files' ? (
            <div className="changed-files">
              {details.changedFiles.length === 0 ? (
                <div className="empty-detail">No changed files in this commit.</div>
              ) : (
                <>
                  <div className="changed-summary">
                    <div className="changed-counts">
                      {changeCounts(details.changedFiles).map((count) => (
                        <span className={`changed-count ${count.kind}`} key={count.kind}>
                          <i className="dot" />{count.total} {KIND_LABEL[count.kind]}
                        </span>
                      ))}
                    </div>
                    <div className="segmented view-toggle" role="group" aria-label="Group files">
                      <button type="button" className={view === 'path' ? 'active' : ''} onClick={() => setView('path')} title="Flat list">
                        <List size={14} /> Path
                      </button>
                      <button type="button" className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')} title="Group by folder">
                        <ListTree size={14} /> Tree
                      </button>
                    </div>
                  </div>
                  {view === 'tree' ? (
                    groupByFolder(details.changedFiles, (file) => file.path).map((group) => (
                      <div className="change-group" key={group.folder}>
                        {group.folder && <div className="change-group-folder" title={group.folder}>{group.folder}</div>}
                        {group.items.map((file, index) => (
                          <ChangedFileRow file={file} showFolder={false} onOpen={openFile} key={`${file.path}:${index}`} />
                        ))}
                      </div>
                    ))
                  ) : (
                    details.changedFiles.map((file, index) => (
                      <ChangedFileRow file={file} showFolder onOpen={openFile} key={`${file.path}:${index}`} />
                    ))
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="diff-pane">
              {details.patchText ? (
                <DiffView patch={details.patchText} />
              ) : (
                <div className="empty-detail">No patch available for this commit.</div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="repository-overview">
          <GitCommitHorizontal size={34} />
          <h2>Select a commit</h2>
          <p>Choose a row in the graph to inspect its metadata, changed files, and patch.</p>
          <dl>
            <div><dt>Repository</dt><dd>{snapshot.identity.root}</dd></div>
            <div><dt>Branch</dt><dd>{snapshot.status.branchName ?? 'Detached HEAD'}</dd></div>
            <div><dt>Worktree</dt><dd>{snapshot.status.isDirty ? 'Dirty' : 'Clean'}</dd></div>
          </dl>
        </div>
      )}
    </aside>
  )
}

function ChangedFileRow({
  file,
  showFolder,
  onOpen
}: {
  file: ChangedFile
  showFolder: boolean
  onOpen(file: ChangedFile): void
}): React.JSX.Element {
  const kind = kindFromStatus(file.status)
  const folder = folderOf(file.path)
  return (
    <button type="button" className="changed-file" onClick={() => onOpen(file)} title={file.path}>
      <span className={`file-status kind-${kind}`}>{KIND_LETTER[kind]}</span>
      <span className="changed-file-name">
        {file.originalPath && <em>{basename(file.originalPath)} → </em>}
        {basename(file.path)}
      </span>
      {showFolder && folder && <span className="changed-file-folder">{folder}</span>}
      <ChevronRight className="changed-file-chevron" size={14} />
    </button>
  )
}

/** Counts changed files by kind, in a stable display order, dropping zeros. */
function changeCounts(files: ChangedFile[]): Array<{ kind: (typeof KIND_ORDER)[number]; total: number }> {
  return KIND_ORDER.map((kind) => ({
    kind,
    total: files.filter((file) => kindFromStatus(file.status) === kind).length
  })).filter((count) => count.total > 0)
}

function DetailsSkeleton(): React.JSX.Element {
  return (
    <div className="details-skeleton" aria-label="Loading commit details">
      <span /><span /><span /><span /><span />
    </div>
  )
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  return `${parts[0][0]}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''}`.toUpperCase()
}

