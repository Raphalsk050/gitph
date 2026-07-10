import { memo, useMemo, useState } from 'react'
import { ChevronDown, FileCode2 } from 'lucide-react'
import { buildSplitRows, parseUnifiedDiff, type DiffFile, type DiffHunk } from '../diff'

export type DiffMode = 'inline' | 'split'

interface DiffViewProps {
  patch: string
  mode?: DiffMode
  wrap?: boolean
}

/**
 * Structured, GitKraken-style diff: one collapsible card per file, hunk
 * separators with function context, old/new line-number gutters and
 * green/red row tinting. Gutters are unselectable so copied text stays clean.
 */
export function DiffView({ patch, mode = 'inline', wrap = false }: DiffViewProps): React.JSX.Element {
  const files = useMemo(() => parseUnifiedDiff(patch), [patch])

  if (files.length === 0) {
    return <div className="empty-detail">No textual changes in this commit.</div>
  }
  return (
    <div className={`diff-view${wrap ? ' wrap' : ''}`}>
      {files.map((file, index) => (
        <DiffFileCard file={file} mode={mode} key={`${file.displayPath}:${index}`} />
      ))}
    </div>
  )
}

const DiffFileCard = memo(function DiffFileCard({ file, mode }: { file: DiffFile; mode: DiffMode }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="diff-file" data-diff-file={file.displayPath}>
      <header className="diff-file-header">
        <button
          type="button"
          className={`diff-collapse${collapsed ? ' closed' : ''}`}
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronDown size={14} />
        </button>
        <FileCode2 size={14} />
        <span className="diff-file-path" title={file.displayPath}>
          {file.renamedFrom && <em>{file.renamedFrom} → </em>}
          {file.displayPath}
        </span>
        {file.isNew && <span className="diff-badge new">new</span>}
        {file.isDeleted && <span className="diff-badge deleted">deleted</span>}
        {file.renamedFrom && <span className="diff-badge renamed">renamed</span>}
        <span className="diff-file-stats">
          {file.additions > 0 && <ins>+{file.additions}</ins>}
          {file.deletions > 0 && <del>−{file.deletions}</del>}
        </span>
      </header>
      {!collapsed && (
        <div className="diff-file-body">
          {file.isBinary ? (
            <div className="diff-binary">Binary file — no textual diff.</div>
          ) : file.hunks.length === 0 ? (
            <div className="diff-binary">No content changes (mode or rename only).</div>
          ) : (
            file.hunks.map((hunk, index) =>
              mode === 'inline' ? (
                <InlineHunk hunk={hunk} key={index} />
              ) : (
                <SplitHunk hunk={hunk} key={index} />
              )
            )
          )}
        </div>
      )}
    </section>
  )
})

function HunkHeader({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  return (
    <div className="diff-hunk-header">
      <span className="diff-hunk-range">
        @@ −{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount}
      </span>
      {hunk.context && <span className="diff-hunk-context">{hunk.context}</span>}
    </div>
  )
}

function InlineHunk({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  return (
    <div className="diff-hunk">
      <HunkHeader hunk={hunk} />
      {hunk.lines.map((line, index) => (
        <div className={`diff-line ${line.kind}`} key={index}>
          <span className="diff-gutter">{line.oldNo ?? ''}</span>
          <span className="diff-gutter">{line.newNo ?? ''}</span>
          <span className="diff-marker">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
          <span className="diff-text">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}

function SplitHunk({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  const rows = useMemo(() => buildSplitRows(hunk), [hunk])
  return (
    <div className="diff-hunk">
      <HunkHeader hunk={hunk} />
      {rows.map((row, index) => (
        <div className="diff-split-row" key={index}>
          <span className={`diff-gutter ${sideClass(row.left?.kind, 'del')}`}>{row.left?.oldNo ?? ''}</span>
          <span className={`diff-text side ${sideClass(row.left?.kind, 'del')}`}>
            {row.left ? row.left.text || ' ' : ''}
          </span>
          <span className={`diff-gutter ${sideClass(row.right?.kind, 'add')}`}>{row.right?.newNo ?? ''}</span>
          <span className={`diff-text side ${sideClass(row.right?.kind, 'add')}`}>
            {row.right ? row.right.text || ' ' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function sideClass(kind: string | undefined, changed: 'add' | 'del'): string {
  if (kind === undefined) return 'blank'
  return kind === changed ? changed : 'context'
}
