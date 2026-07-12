import { isAbsolute, resolve } from 'node:path'
import type {
  ChangedFile,
  CommitSummary,
  GitRef,
  RefKind,
  RepoIdentity,
  StatusEntry,
  StatusSnapshot
} from '../../shared/contracts'

export function parseRepoIdentity(
  requestedPath: string,
  revParseOutput: string,
  headRefOutput: string,
  headOidOutput: string
): RepoIdentity {
  const lines = revParseOutput.split(/\r?\n/u).map((line) => line.trim())
  const root = lines[0] || resolve(requestedPath)
  const rawGitDir = lines[1] || resolve(root, '.git')
  return {
    root,
    gitDir: isAbsolute(rawGitDir) ? rawGitDir : resolve(root, rawGitDir),
    isBare: lines[2]?.toLowerCase() === 'true',
    headOid: headOidOutput.trim() || null,
    headRef: headRefOutput.trim() || null
  }
}

export function parseStatus(output: string): StatusSnapshot {
  let branchName: string | null = null
  let branchOid: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const entries: StatusEntry[] = []
  const records = output.split('\0')

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length).trim()
      branchName = value === '(detached)' ? null : value
    } else if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length).trim()
      branchOid = value === '(initial)' ? null : value
    } else if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length).trim() || null
    } else if (record.startsWith('# branch.ab ')) {
      for (const part of record.slice('# branch.ab '.length).split(' ')) {
        if (part.startsWith('+')) ahead = parseInteger(part.slice(1))
        if (part.startsWith('-')) behind = parseInteger(part.slice(1))
      }
    } else if (record.startsWith('? ') || record.startsWith('! ')) {
      const marker = record[0]
      entries.push({ path: record.slice(2), indexStatus: marker, worktreeStatus: marker, originalPath: null })
    } else if (record.startsWith('1 ') || record.startsWith('u ')) {
      const fields = splitAtMost(record, 8)
      if (fields.length >= 9) {
        entries.push({
          path: fields[8],
          indexStatus: fields[1]?.slice(0, 1) || ' ',
          worktreeStatus: fields[1]?.slice(1, 2) || ' ',
          originalPath: null
        })
      }
    } else if (record.startsWith('2 ')) {
      const fields = splitAtMost(record, 9)
      if (fields.length >= 10) {
        entries.push({
          path: fields[9],
          indexStatus: fields[1]?.slice(0, 1) || ' ',
          worktreeStatus: fields[1]?.slice(1, 2) || ' ',
          originalPath: records[index + 1] || null
        })
        index += 1
      }
    }
  }

  return { branchName, branchOid, upstream, ahead, behind, entries, isDirty: entries.length > 0 }
}

export function parseRefs(output: string): GitRef[] {
  const refs: GitRef[] = []
  for (const rawRecord of output.split('\x1e')) {
    const record = rawRecord.replace(/^\r?\n|\r?\n$/gu, '')
    if (!record) continue
    const fields = record.split('\0')
    if (fields.length < 11) continue
    const [fullName, shortName, objectType, objectName, peeledType, peeledName, headMarker, upstream, upstreamShort, , subject] = fields
    const kind = refKind(fullName)
    if (kind === null) continue
    const peeledOid = peeledType === 'commit' && peeledName ? peeledName : null
    const targetOid = objectType ? objectName : peeledName
    if (!targetOid) continue
    refs.push({
      fullName,
      shortName,
      kind,
      targetOid,
      peeledOid,
      upstream: upstreamShort || upstream || null,
      isHead: headMarker === '*',
      subject,
      displayOid: peeledOid || targetOid
    })
  }
  return refs
}

export function parseRemoteNames(output: string): string[] {
  const remotes = new Set<string>()
  for (const line of output.split(/\r?\n/u)) {
    const name = line.trim()
    if (name) remotes.add(name)
  }
  return [...remotes]
}

export function parseCommits(output: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const rawRecord of output.split('\x1e')) {
    const record = rawRecord.replace(/^\r?\n|\r?\n$/gu, '')
    if (!record) continue
    const separator = record.indexOf('\x1f')
    const payload = separator >= 0 ? record.slice(separator + 1) : record
    const fields = payload.split('\0', 7)
    if (fields.length < 7) continue
    const [oid, parents, authorTime, commitTime, author, authorEmail, subject] = fields
    commits.push({
      oid,
      parents: parents.split(' ').filter(Boolean),
      author,
      authorEmail,
      authorTime: parseInteger(authorTime),
      commitTime: parseInteger(commitTime),
      subject: subject.trim(),
      shortOid: oid.slice(0, 8)
    })
  }
  return commits
}

export function parseChangedFiles(output: string): ChangedFile[] {
  const tokens = output.split('\0').filter(Boolean)
  if (tokens.length > 0 && looksLikeObjectId(tokens[0])) tokens.shift()
  const files: ChangedFile[] = []
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++]
    if (!status) continue
    if ((status.startsWith('R') || status.startsWith('C')) && index + 1 < tokens.length) {
      files.push({ status, originalPath: tokens[index++], path: tokens[index++] })
    } else if (index < tokens.length) {
      files.push({ status, originalPath: null, path: tokens[index++] })
    }
  }
  return files
}

function splitAtMost(value: string, maxSplits: number): string[] {
  const fields: string[] = []
  let start = 0
  for (let split = 0; split < maxSplits; split += 1) {
    const separator = value.indexOf(' ', start)
    if (separator < 0) break
    fields.push(value.slice(start, separator))
    start = separator + 1
  }
  fields.push(value.slice(start))
  return fields
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function refKind(fullName: string): RefKind | null {
  if (fullName.startsWith('refs/heads/')) return 'local_branch'
  if (fullName.startsWith('refs/remotes/')) return 'remote_branch'
  if (fullName.startsWith('refs/tags/')) return 'tag'
  if (fullName === 'refs/stash') return 'stash'
  return null
}

function looksLikeObjectId(value: string): boolean {
  return (value.length === 40 || value.length === 64) && /^[0-9a-f]+$/iu.test(value)
}
