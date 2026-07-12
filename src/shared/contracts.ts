export type RefKind = 'local_branch' | 'remote_branch' | 'tag' | 'stash'

export interface RepoIdentity {
  root: string
  gitDir: string
  isBare: boolean
  headOid: string | null
  headRef: string | null
}

export interface GitRef {
  fullName: string
  shortName: string
  kind: RefKind
  targetOid: string
  peeledOid: string | null
  upstream: string | null
  isHead: boolean
  subject: string
  displayOid: string
}

export interface StatusEntry {
  path: string
  indexStatus: string
  worktreeStatus: string
  originalPath: string | null
}

export interface StatusSnapshot {
  branchName: string | null
  branchOid: string | null
  upstream: string | null
  ahead: number
  behind: number
  entries: StatusEntry[]
  isDirty: boolean
}

export interface CommitSummary {
  oid: string
  parents: string[]
  author: string
  authorEmail: string
  authorTime: number
  commitTime: number
  subject: string
  graphPrefix: string
  shortOid: string
}

export interface GraphEdge {
  fromOid: string
  toOid: string
  fromLane: number
  toLane: number
  colorIndex: number
  kind: 'parent' | 'merge'
}

export interface GraphRow {
  commit: CommitSummary
  rowIndex: number
  lane: number
  refs: GitRef[]
  edges: GraphEdge[]
  activeLanes: Array<string | null>
}

export interface GraphModel {
  rows: GraphRow[]
  maxLanes: number
}

export interface ChangedFile {
  path: string
  status: string
  originalPath: string | null
}

export interface CommitDetails {
  summary: CommitSummary
  body: string
  changedFiles: ChangedFile[]
  patchText: string
}

export interface RepositorySnapshot {
  identity: RepoIdentity
  status: StatusSnapshot
  remotes: string[]
  refs: GitRef[]
  graph: GraphModel
}

export interface WorkspacePayload {
  snapshot: RepositorySnapshot | null
  recentRepositories: string[]
  cancelled?: boolean
}

export const GIT_ACTION_KINDS = [
  'fetch_all',
  'fetch_remote',
  'pull_ff',
  'push_head',
  'publish_branch',
  'switch_branch',
  'track_remote',
  'merge_branch',
  'rebase_onto_branch',
  'delete_branch',
  'checkout_tag',
  'delete_tag',
  'checkout_commit',
  'create_branch',
  'create_tag',
  'cherry_pick',
  'revert_commit',
  'reset_soft',
  'reset_mixed',
  'reset_hard'
] as const

export type GitActionKind = (typeof GIT_ACTION_KINDS)[number]

export interface ActionDescriptor {
  kind: GitActionKind
  label: string
  target: string
  command: string
  refName?: string
  remoteName?: string
  oid?: string
  /** When set, the renderer must collect a ref name before executing. */
  requiresName?: boolean
  namePlaceholder?: string
  requiresCleanTree: boolean
  riskLevel: 'normal' | 'high'
}

export interface ActionRequest {
  kind: GitActionKind
  refName?: string
  remoteName?: string
  oid?: string
  name?: string
}

export interface ActionExecutionResult {
  action: ActionDescriptor
  exitCode: number
  stdout: string
  stderr: string
  workspace?: WorkspacePayload
}

/** Request to read the diff of a single working-tree file. */
export interface WorkingDiffRequest {
  path: string
  /** Read the staged (index) diff instead of the worktree diff. */
  staged: boolean
  /** Untracked files have no index entry, so they diff against an empty tree. */
  untracked: boolean
}

export interface CommitRequest {
  summary: string
  description?: string
  amend?: boolean
  /** Stage every change before committing (the "commit all" affordance). */
  stageAll?: boolean
}

export interface CommitResult {
  exitCode: number
  stdout: string
  stderr: string
  workspace?: WorkspacePayload
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface GitphApi {
  bootstrap(): Promise<IpcResult<WorkspacePayload>>
  openRepository(path?: string): Promise<IpcResult<WorkspacePayload>>
  refreshRepository(): Promise<IpcResult<WorkspacePayload>>
  getCommitDetails(oid: string): Promise<IpcResult<CommitDetails>>
  listActions(refName?: string, oid?: string): Promise<IpcResult<ActionDescriptor[]>>
  executeAction(request: ActionRequest): Promise<IpcResult<ActionExecutionResult>>
  stageEntries(paths: string[]): Promise<IpcResult<WorkspacePayload>>
  unstageEntries(paths: string[]): Promise<IpcResult<WorkspacePayload>>
  discardEntries(paths: string[]): Promise<IpcResult<WorkspacePayload>>
  commitChanges(request: CommitRequest): Promise<IpcResult<CommitResult>>
  getWorkingDiff(request: WorkingDiffRequest): Promise<IpcResult<string>>
  copyText(text: string): Promise<IpcResult<void>>
  openDiffWindow(oid: string): Promise<IpcResult<void>>
  isWindowMaximized(): Promise<IpcResult<boolean>>
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
}

export const IPC_CHANNELS = {
  bootstrap: 'workspace:bootstrap',
  openRepository: 'workspace:open-repository',
  refreshRepository: 'workspace:refresh',
  commitDetails: 'workspace:commit-details',
  listActions: 'workspace:list-actions',
  executeAction: 'workspace:execute-action',
  stageEntries: 'worktree:stage',
  unstageEntries: 'worktree:unstage',
  discardEntries: 'worktree:discard',
  commitChanges: 'worktree:commit',
  workingDiff: 'worktree:diff',
  copyText: 'system:copy-text',
  openDiffWindow: 'window:open-diff',
  windowIsMaximized: 'window:is-maximized',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximized-changed'
} as const

