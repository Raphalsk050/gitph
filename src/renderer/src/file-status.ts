/**
 * Shared vocabulary for describing a changed file, used by both the working-tree
 * panel and the committed-commit details. Keeping the mapping in one place means
 * "modified vs added" reads the same everywhere in the app.
 */

export type ChangeKind = 'new' | 'modified' | 'deleted' | 'renamed' | 'conflicted'

/** Human label shown next to a file or in a count summary. */
export const KIND_LABEL: Record<ChangeKind, string> = {
  new: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  conflicted: 'conflicted'
}

/** Single-letter badge, normalised across git's status spellings (e.g. R100 → R). */
export const KIND_LETTER: Record<ChangeKind, string> = {
  new: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflicted: 'U'
}

/** Kinds in the order they should appear in a count summary. */
export const KIND_ORDER: ChangeKind[] = ['modified', 'new', 'deleted', 'renamed', 'conflicted']

/**
 * Maps a git status token to a kind. Accepts porcelain letters (`M`, `A`, `D`,
 * `R`, `C`, `U`, `?`) as well as name-status codes with a score (`R100`).
 */
export function kindFromStatus(status: string): ChangeKind {
  switch (status[0]?.toUpperCase()) {
    case 'A':
    case '?':
      return 'new'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}

/** Directory portion of a path, without a trailing slash (empty for repo root). */
export function folderOf(path: string): string {
  const name = basename(path)
  return path.slice(0, path.length - name.length).replace(/\/$/u, '')
}

/** Groups items by their containing folder, sorted alphabetically. */
export function groupByFolder<T>(items: T[], getPath: (item: T) => string): Array<{ folder: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const folder = folderOf(getPath(item))
    const bucket = map.get(folder)
    if (bucket) bucket.push(item)
    else map.set(folder, [item])
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, groupItems]) => ({ folder, items: groupItems }))
}
