/**
 * Parses git unified diff output into a structured model the renderer can
 * paint: files → hunks → lines with old/new line numbers. Raw patch headers
 * (`diff --git`, `index`, `---`/`+++`, mode changes) become file metadata
 * instead of visible text.
 */

export interface DiffLine {
  kind: 'add' | 'del' | 'context'
  oldNo: number | null
  newNo: number | null
  text: string
}

export interface DiffHunk {
  /** Function/scope context git prints after the second `@@`. */
  context: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface DiffFile {
  displayPath: string
  renamedFrom: string | null
  isBinary: boolean
  isNew: boolean
  isDeleted: boolean
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

const HUNK_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/u

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let renameFrom: string | null = null

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = {
        displayPath: parseGitHeaderPath(line),
        renamedFrom: null,
        isBinary: false,
        isNew: false,
        isDeleted: false,
        additions: 0,
        deletions: 0,
        hunks: []
      }
      files.push(file)
      hunk = null
      renameFrom = null
      continue
    }
    if (!file) continue

    if (hunk) {
      const marker = line[0]
      if (marker === '+') {
        hunk.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) })
        file.additions += 1
        continue
      }
      if (marker === '-') {
        hunk.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) })
        file.deletions += 1
        continue
      }
      if (marker === ' ' || (line === '' && hunk.lines.length > 0)) {
        hunk.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) })
        continue
      }
      if (line.startsWith('\\')) continue // "\ No newline at end of file"
      hunk = null // anything else ends the hunk and falls through to headers
    }

    const hunkMatch = HUNK_PATTERN.exec(line)
    if (hunkMatch) {
      oldNo = Number(hunkMatch[1])
      newNo = Number(hunkMatch[3])
      hunk = {
        context: hunkMatch[5] ?? '',
        oldStart: oldNo,
        oldCount: Number(hunkMatch[2] ?? '1'),
        newStart: newNo,
        newCount: Number(hunkMatch[4] ?? '1'),
        lines: []
      }
      file.hunks.push(hunk)
      continue
    }

    if (line.startsWith('rename from ') || line.startsWith('copy from ')) {
      renameFrom = line.replace(/^(rename|copy) from /u, '')
    } else if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
      file.renamedFrom = renameFrom
      file.displayPath = line.replace(/^(rename|copy) to /u, '')
    } else if (line.startsWith('new file mode')) {
      file.isNew = true
    } else if (line.startsWith('deleted file mode')) {
      file.isDeleted = true
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.isBinary = true
    } else if (line.startsWith('+++ ')) {
      const path = stripPathPrefix(line.slice(4))
      if (path) file.displayPath = path
    }
    // `index`, mode, similarity and `--- ` lines carry nothing else we render.
  }
  return files
}

/** Rows for the side-by-side view: deletions pair with the adds that replaced them. */
export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

export function buildSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let pendingDels: DiffLine[] = []
  let pairIndex = 0

  const flush = (): void => {
    for (; pairIndex < pendingDels.length; pairIndex++) {
      rows.push({ left: pendingDels[pairIndex], right: null })
    }
    pendingDels = []
    pairIndex = 0
  }

  for (const line of hunk.lines) {
    if (line.kind === 'del') {
      pendingDels.push(line)
    } else if (line.kind === 'add') {
      if (pairIndex < pendingDels.length) {
        rows.push({ left: pendingDels[pairIndex++], right: line })
      } else {
        rows.push({ left: null, right: line })
      }
    } else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}

function parseGitHeaderPath(line: string): string {
  // `diff --git a/path b/path` — take the b/ side; tolerate quoted paths.
  const unquoted = line.replace(/^diff --git /u, '')
  const match = /(?:^|\s)"?b\/(.+?)"?$/u.exec(unquoted)
  return match ? match[1] : unquoted
}

function stripPathPrefix(path: string): string | null {
  if (path === '/dev/null') return null
  return path.replace(/^"?[ab]\//u, '').replace(/"$/u, '')
}
