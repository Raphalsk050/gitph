import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type {
  ActionDescriptor,
  ActionExecutionResult,
  ActionRequest,
  CommitDetails,
  WorkspacePayload
} from '../shared/contracts'
import { GitActionService } from './git/action-service'
import type { LoadedRepository } from './git/repository-service'
import { RepositoryService } from './git/repository-service'
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
  private readonly settings: SettingsStore
  private readonly getWindow: () => BrowserWindow | null
  private current: LoadedRepository | null = null
  private recentRepositories: string[] = []
  private transition: Promise<void> = Promise.resolve()
  private bootstrapPromise: Promise<WorkspacePayload> | null = null

  constructor(
    repositories: RepositoryService,
    actions: GitActionService,
    settings: SettingsStore,
    getWindow: () => BrowserWindow | null
  ) {
    this.repositories = repositories
    this.actions = actions
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
    return this.actions.listActions(ref)
  }

  async executeAction(request: ActionRequest): Promise<ActionExecutionResult> {
    return await this.enqueue(async () => {
      if (this.current === null) throw new Error('Open a Git repository first.')
      const plan = this.actions.resolve(request, this.current.snapshot.refs, this.current.commits)
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

  private async openPath(path: string): Promise<void> {
    const loaded = await this.repositories.loadSnapshot(resolve(path))
    this.current = loaded
    this.recentRepositories = await this.settings.remember(loaded.snapshot.identity.root)
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
