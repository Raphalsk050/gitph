import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ActionDescriptor,
  ActionExecutionResult,
  ActionRequest,
  CommitDetails,
  CommitRequest,
  CommitResult,
  WorkingDiffRequest,
  WorkspacePayload
} from '../shared/contracts'
import { GitActionService } from './git/action-service'
import type { LoadedRepository } from './git/repository-service'
import { RepositoryService } from './git/repository-service'
import { RepositoryWatcher } from './git/repository-watcher'
import { GitWorkingTreeService } from './git/working-tree-service'
import { SettingsStore } from './settings-store'

/**
 * @brief Owns the active repository session exposed through IPC.
 *
 * Responsibility: serialize repository transitions, retain trusted commit/ref
 * state, coordinate persistence, and expose only coarse application use cases.
 */
export class RepositoryController {
  private readonly repositories: RepositoryService
  private readonly actions: GitActionService
  private readonly workingTree: GitWorkingTreeService
  private readonly settings: SettingsStore
  private readonly getWindow: () => BrowserWindow | null
  private readonly watcher = new RepositoryWatcher()
  private current: LoadedRepository | null = null
  private recentRepositories: string[] = []
  private transition: Promise<void> = Promise.resolve()
  private bootstrapPromise: Promise<WorkspacePayload> | null = null

  constructor(
    repositories: RepositoryService,
    actions: GitActionService,
    workingTree: GitWorkingTreeService,
    settings: SettingsStore,
    getWindow: () => BrowserWindow | null
  ) {
    this.repositories = repositories
    this.actions = actions
    this.workingTree = workingTree
    this.settings = settings
    this.getWindow = getWindow
  }

  async bootstrap(): Promise<WorkspacePayload> {
    this.bootstrapPromise ??= this.enqueue(() => this.bootstrapImpl())
    return await this.bootstrapPromise
  }

  private async bootstrapImpl(): Promise<WorkspacePayload> {
    this.recentRepositories = await this.settings.load()
    const candidates = [...new Set([this.recentRepositories[0], process.cwd()].filter(Boolean))] as string[]
    for (const candidate of candidates) {
      try {
        await this.openPath(candidate)
        return this.workspace()
      } catch {
        // Invalid recent paths are kept visible so the user can replace them explicitly.
      }
    }
    return this.workspace()
  }

  async openRepository(requestedPath?: string): Promise<WorkspacePayload> {
    return await this.enqueue(() => this.openRepositoryImpl(requestedPath))
  }

  private async openRepositoryImpl(requestedPath?: string): Promise<WorkspacePayload> {
    let selectedPath = requestedPath
    if (selectedPath === undefined) {
      const options: Electron.OpenDialogOptions = {
        title: 'Open Git repository',
        defaultPath: this.current?.snapshot.identity.root ?? this.recentRepositories[0] ?? homedir(),
        properties: ['openDirectory']
      }
      const parent = this.getWindow()
      const selection = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (selection.canceled || selection.filePaths.length === 0) {
        return { ...this.workspace(), cancelled: true }
      }
      selectedPath = selection.filePaths[0]
    }
    await this.openPath(selectedPath)
    return this.workspace()
  }

  async refresh(): Promise<WorkspacePayload> {
    return await this.enqueue(async () => {
      if (this.current === null) throw new Error('Open a Git repository first.')
      this.current = await this.repositories.loadSnapshot(this.current.snapshot.identity.root)
      return this.workspace()
    })
  }

  async commitDetails(oid: string): Promise<CommitDetails> {
    if (this.current === null) throw new Error('Open a Git repository first.')
    const summary = this.current.commits.get(oid)
    if (summary === undefined) throw new Error('The commit is not part of the current graph.')
    return await this.repositories.loadCommitDetails(this.current.snapshot.identity.root, summary)
  }

  listActions(refName?: string, oid?: string): ActionDescriptor[] {
    if (this.current === null) throw new Error('Open a Git repository first.')
    if (oid !== undefined) {
      const commit = this.current.commits.get(oid)
      if (commit === undefined) throw new Error('The commit is not part of the current graph.')
      return this.actions.listCommitActions(commit)
    }
    const ref = refName
      ? this.current.snapshot.refs.find((candidate) => candidate.fullName === refName)
      : undefined
    if (refName && ref === undefined) throw new Error('The selected ref no longer exists.')
    return this.actions.listActions(ref, this.current.snapshot.refs, this.current.snapshot.remotes)
  }

  async executeAction(request: ActionRequest): Promise<ActionExecutionResult> {
    return await this.enqueue(async () => {
      if (this.current === null) throw new Error('Open a Git repository first.')
      const plan = this.actions.resolve(
        request,
        this.current.snapshot.refs,
        this.current.snapshot.remotes,
        this.current.commits
      )
      const result = await this.actions.execute(
        this.current.snapshot.identity.root,
        plan,
        this.current.snapshot.status
      )
      if (result.exitCode !== 0) {
        return {
          action: plan.descriptor,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr
        }
      }
      this.current = await this.repositories.loadSnapshot(this.current.snapshot.identity.root)
      return {
        action: plan.descriptor,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        workspace: this.workspace()
      }
    })
  }

  async stageEntries(paths: string[]): Promise<WorkspacePayload> {
    return await this.enqueue(async () => {
      const repo = this.requireCurrent()
      const verified = this.verifyPaths(repo, paths)
      this.assertOk(await this.workingTree.stage(repo.snapshot.identity.root, verified))
      return await this.reloadWorkspace()
    })
  }

  async unstageEntries(paths: string[]): Promise<WorkspacePayload> {
    return await this.enqueue(async () => {
      const repo = this.requireCurrent()
      const verified = this.verifyPaths(repo, paths)
      this.assertOk(await this.workingTree.unstage(repo.snapshot.identity.root, verified))
      return await this.reloadWorkspace()
    })
  }

  async discardEntries(paths: string[]): Promise<WorkspacePayload> {
    return await this.enqueue(async () => {
      const repo = this.requireCurrent()
      const verified = this.verifyPaths(repo, paths)
      const tracked: string[] = []
      const untracked: string[] = []
      for (const path of verified) {
        const entry = repo.snapshot.status.entries.find((candidate) => candidate.path === path)
        if (entry && entry.indexStatus === '?' && entry.worktreeStatus === '?') untracked.push(path)
        else tracked.push(path)
      }
      const hasHead = repo.snapshot.identity.headOid !== null
      this.assertOk(await this.workingTree.discard(repo.snapshot.identity.root, tracked, untracked, hasHead))
      return await this.reloadWorkspace()
    })
  }

  async commitChanges(request: CommitRequest): Promise<CommitResult> {
    return await this.enqueue(async () => {
      const repo = this.requireCurrent()
      const summary = request.summary.trim()
      if (!summary) throw new Error('A commit summary is required.')
      const root = repo.snapshot.identity.root
      if (request.stageAll) {
        const staged = await this.workingTree.stageAll(root)
        if (staged.exitCode !== 0) {
          return { exitCode: staged.exitCode, stdout: staged.stdout, stderr: staged.stderr }
        }
      }
      const result = await this.workingTree.commit(
        root,
        summary,
        request.description?.trim() || undefined,
        request.amend ?? false
      )
      if (result.exitCode !== 0) {
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
      }
      return {
        exitCode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
        workspace: await this.reloadWorkspace()
      }
    })
  }

  async workingDiff(request: WorkingDiffRequest): Promise<string> {
    const repo = this.requireCurrent()
    this.verifyPaths(repo, [request.path])
    const result = await this.workingTree.diff(
      repo.snapshot.identity.root,
      request.path,
      request.staged,
      request.untracked
    )
    return result.stdout
  }

  private requireCurrent(): LoadedRepository {
    if (this.current === null) throw new Error('Open a Git repository first.')
    return this.current
  }

  /** Only paths present in the loaded status snapshot may be operated on. */
  private verifyPaths(repo: LoadedRepository, paths: string[]): string[] {
    if (paths.length === 0) throw new Error('No files were provided.')
    const known = new Set<string>()
    for (const entry of repo.snapshot.status.entries) {
      known.add(entry.path)
      if (entry.originalPath) known.add(entry.originalPath)
    }
    const verified = paths.filter((path) => known.has(path))
    if (verified.length !== paths.length) {
      throw new Error('Some files are no longer part of the working tree. Refresh and try again.')
    }
    return verified
  }

  private assertOk(result: { exitCode: number; stdout: string; stderr: string }): void {
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'The Git operation failed.')
    }
  }

  private async reloadWorkspace(): Promise<WorkspacePayload> {
    const repo = this.requireCurrent()
    this.current = await this.repositories.loadSnapshot(repo.snapshot.identity.root)
    return this.workspace()
  }

  private async openPath(path: string): Promise<void> {
    const loaded = await this.repositories.loadSnapshot(resolve(path))
    this.current = loaded
    this.recentRepositories = await this.settings.remember(loaded.snapshot.identity.root)
    const root = loaded.snapshot.identity.root
    this.watcher.watch(root, () => void this.handleRepoChange(root))
  }

  /**
   * Reacts to on-disk changes in the open repository by reloading the snapshot
   * and pushing it to the renderer, so commits, checkouts and working-tree edits
   * made outside the app appear without a manual refresh. Serialized through the
   * same queue as user operations, and a no-op once the repository has changed.
   */
  private async handleRepoChange(root: string): Promise<void> {
    if (this.current?.snapshot.identity.root !== root) return
    try {
      const payload = await this.enqueue(async () => {
        if (this.current?.snapshot.identity.root !== root) return null
        this.current = await this.repositories.loadSnapshot(root)
        return this.workspace()
      })
      if (payload) this.getWindow()?.webContents.send(IPC_CHANNELS.workspaceChanged, payload)
    } catch {
      // A transient read (e.g. during an external git operation) is ignored; the
      // next settled change reloads cleanly.
    }
  }

  private workspace(): WorkspacePayload {
    return {
      snapshot: this.current?.snapshot ?? null,
      recentRepositories: [...this.recentRepositories]
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
