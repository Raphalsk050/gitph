import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AArrowDown,
  AArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  FileCode2,
  GitCommitHorizontal,
  Maximize2,
  Minus,
  Rows3,
  WrapText,
  X
} from 'lucide-react'
import type { CommitDetails } from '@shared/contracts'
import { parseUnifiedDiff } from '../diff'
import { DiffView, type DiffMode } from './DiffView'

const FONT_SIZES = [9.5, 10.5, 11, 12, 13, 14]
const DEFAULT_FONT_INDEX = 2

/**
 * Standalone patch window: file navigator, inline/side-by-side modes, hunk
 * stepping, word wrap and font controls. Keyboard: n/p hunks, j/k files,
 * w wrap, s split, Esc closes.
 */
export function DiffWindow({ oid }: { oid: string }): React.JSX.Element {
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<DiffMode>('inline')
  const [wrap, setWrap] = useState(false)
  const [fontIndex, setFontIndex] = useState(DEFAULT_FONT_INDEX)
  const [fileIndex, setFileIndex] = useState(0)
  const [hunkIndex, setHunkIndex] = useState(-1)
  const [copied, setCopied] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    void window.gitph.getCommitDetails(oid).then((result) => {
      if (!active) return
      if (result.ok) setDetails(result.value)
      else setError(result.error)
    })
    return () => {
      active = false
    }
  }, [oid])

  const files = useMemo(() => (details ? parseUnifiedDiff(details.patchText) : []), [details])
  const statusByPath = useMemo(
    () => new Map(details?.changedFiles.map((file) => [file.path, file.status]) ?? []),
    [details]
  )
  const hunkCount = useMemo(() => files.reduce((count, file) => count + file.hunks.length, 0), [files])

  const jumpToFile = useCallback((index: number, total: number): void => {
    const clamped = Math.min(Math.max(index, 0), Math.max(total - 1, 0))
    setFileIndex(clamped)
    scroller.current
      ?.querySelectorAll('.diff-file')
      [clamped]?.scrollIntoView({ block: 'start' })
  }, [])

  const jumpToHunk = useCallback((index: number, total: number): void => {
    if (total === 0) return
    const clamped = ((index % total) + total) % total
    setHunkIndex(clamped)
    const header = scroller.current?.querySelectorAll('.diff-hunk-header')[clamped]
    if (!header) return
    header.scrollIntoView({ block: 'center' })
    header.classList.remove('flash')
    // Restart the highlight animation even when re-visiting the same hunk.
    void (header as HTMLElement).offsetWidth
    header.classList.add('flash')
  }, [])

  const copyPatch = async (): Promise<void> => {
    if (!details) return
    const result = await window.gitph.copyText(details.patchText)
    if (!result.ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement) return
      switch (event.key) {
        case 'Escape':
          window.gitph.closeWindow()
          break
        case 'n':
          jumpToHunk(hunkIndex + 1, hunkCount)
          break
        case 'p':
          jumpToHunk(hunkIndex - 1, hunkCount)
          break
        case 'j':
          jumpToFile(fileIndex + 1, files.length)
          break
        case 'k':
          jumpToFile(fileIndex - 1, files.length)
          break
        case 'w':
          setWrap((value) => !value)
          break
        case 's':
          setMode((value) => (value === 'inline' ? 'split' : 'inline'))
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fileIndex, files.length, hunkCount, hunkIndex, jumpToFile, jumpToHunk])

  return (
    <div className="diff-window">
      <header className="titlebar">
        <div className="titlebar-brand">
          <GitCommitHorizontal size={14} strokeWidth={2.4} />
          <span>{details ? details.summary.shortOid : oid.slice(0, 8)}</span>
        </div>
        <div className="titlebar-context">{details?.summary.subject ?? 'Commit patch'}</div>
        <div className="window-controls">
          <button type="button" aria-label="Minimize" onClick={() => window.gitph.minimizeWindow()}>
            <Minus size={15} />
          </button>
          <button type="button" aria-label="Maximize" onClick={() => window.gitph.toggleMaximizeWindow()}>
            <Maximize2 size={13} />
          </button>
          <button type="button" className="window-close" aria-label="Close" onClick={() => window.gitph.closeWindow()}>
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="diff-window-toolbar">
        <div className="diff-nav-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous file"
            title="Previous file (k)"
            disabled={files.length === 0}
            onClick={() => jumpToFile(fileIndex - 1, files.length)}
          >
            <ChevronUp size={15} />
          </button>
          <span className="diff-nav-count">
            {files.length === 0 ? 'No files' : `File ${fileIndex + 1}/${files.length}`}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next file"
            title="Next file (j)"
            disabled={files.length === 0}
            onClick={() => jumpToFile(fileIndex + 1, files.length)}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="diff-nav-group">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous change"
            title="Previous change (p)"
            disabled={hunkCount === 0}
            onClick={() => jumpToHunk(hunkIndex - 1, hunkCount)}
          >
            <ChevronUp size={15} />
          </button>
          <span className="diff-nav-count">
            {hunkCount === 0 ? 'No hunks' : `Hunk ${Math.max(hunkIndex, 0) + 1}/${hunkCount}`}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Next change"
            title="Next change (n)"
            disabled={hunkCount === 0}
            onClick={() => jumpToHunk(hunkIndex + 1, hunkCount)}
          >
            <ChevronDown size={15} />
          </button>
        </div>

        <div className="segmented" role="radiogroup" aria-label="Diff layout">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'inline'}
            className={mode === 'inline' ? 'active' : ''}
            title="Inline view (s)"
            onClick={() => setMode('inline')}
          >
            <Rows3 size={14} /> Inline
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'split'}
            className={mode === 'split' ? 'active' : ''}
            title="Side-by-side view (s)"
            onClick={() => setMode('split')}
          >
            <Columns2 size={14} /> Split
          </button>
        </div>

        <button
          type="button"
          className={`icon-button toggle${wrap ? ' active' : ''}`}
          aria-label="Toggle word wrap"
          aria-pressed={wrap}
          title="Word wrap (w)"
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Smaller text"
          title="Smaller text"
          disabled={fontIndex === 0}
          onClick={() => setFontIndex((index) => Math.max(0, index - 1))}
        >
          <AArrowDown size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Larger text"
          title="Larger text"
          disabled={fontIndex === FONT_SIZES.length - 1}
          onClick={() => setFontIndex((index) => Math.min(FONT_SIZES.length - 1, index + 1))}
        >
          <AArrowUp size={15} />
        </button>
        <button type="button" className="toolbar-button diff-copy" onClick={() => void copyPatch()} disabled={!details}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? 'Copied' : 'Copy patch'}</span>
        </button>
      </div>

      <div className="diff-window-body">
        <nav className="diff-window-files" aria-label="Changed files">
          {files.map((file, index) => (
            <button
              type="button"
              className={`diff-file-item${index === fileIndex ? ' active' : ''}`}
              onClick={() => jumpToFile(index, files.length)}
              key={`${file.displayPath}:${index}`}
            >
              <span className={`file-status status-${(statusByPath.get(file.displayPath) ?? 'M')[0]?.toLocaleLowerCase()}`}>
                {statusByPath.get(file.displayPath) ?? (file.isNew ? 'A' : file.isDeleted ? 'D' : 'M')}
              </span>
              <span className="diff-file-item-path" title={file.displayPath}>{file.displayPath}</span>
              <span className="diff-file-item-stats">
                {file.additions > 0 && <ins>+{file.additions}</ins>}
                {file.deletions > 0 && <del>−{file.deletions}</del>}
              </span>
            </button>
          ))}
          {details && files.length === 0 && <div className="empty-detail">No textual changes.</div>}
        </nav>
        <div
          className="diff-window-scroll"
          ref={scroller}
          style={{ '--diff-font': `${FONT_SIZES[fontIndex]}px` } as React.CSSProperties}
        >
          {error ? (
            <div className="diff-window-error">
              <FileCode2 size={22} />
              <strong>Could not load this patch</strong>
              <span>{error}</span>
            </div>
          ) : details ? (
            <DiffView patch={details.patchText} mode={mode} wrap={wrap} />
          ) : (
            <div className="details-skeleton" aria-label="Loading patch">
              <span /><span /><span /><span /><span />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
