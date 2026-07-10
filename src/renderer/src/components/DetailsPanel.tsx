import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, FileCode2, GitCommitHorizontal, X } from 'lucide-react'
import type { CommitDetails, RepositorySnapshot } from '@shared/contracts'
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

export function DetailsPanel({
  snapshot,
  details,
  loading,
  open,
  onCopy,
  onClose
}: DetailsPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DetailTab>('files')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setTab('files')
    setCopied(false)
  }, [details?.summary.oid])

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
        <>
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
              {details.changedFiles.map((file, index) => (
                <div className="changed-file" key={`${file.path}:${index}`}>
                  <span className={`file-status status-${file.status[0]?.toLocaleLowerCase()}`}>{file.status}</span>
                  <FileCode2 size={15} />
                  <div>
                    {file.originalPath && <small>{file.originalPath} →</small>}
                    <span>{file.path}</span>
                  </div>
                </div>
              ))}
              {details.changedFiles.length === 0 && <div className="empty-detail">No changed files in this commit.</div>}
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
        </>
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

