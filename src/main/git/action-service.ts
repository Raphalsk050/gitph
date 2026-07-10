import type {
  ActionDescriptor,
  ActionRequest,
  GitActionKind,
  GitRef,
  StatusSnapshot
} from '../../shared/contracts'
import type { CommandResult } from './command-runner'
import { GitCommandRunner } from './command-runner'

interface ActionPlan {
  descriptor: ActionDescriptor
  argv: string[]
}

/**
 * @brief Owns the allowlisted set of mutating Git operations.
 *
 * Responsibility: rebuild every requested action from trusted repository refs,
 * enforce clean-tree preconditions, and prevent renderer-controlled argv.
 */
export class GitActionService {
  private readonly runner: GitCommandRunner

  constructor(runner: GitCommandRunner) {
    this.runner = runner
  }

  listActions(ref: GitRef | undefined): ActionDescriptor[] {
    if (ref === undefined) {
      return [this.fetchAll().descriptor]
    }
    if (ref.kind === 'local_branch') {
      return [this.switchBranch(ref).descriptor]
    }
    if (ref.kind === 'remote_branch') {
      return [this.trackRemote(ref).descriptor, this.fetchRemote(ref).descriptor]
    }
    return []
  }

  resolve(request: ActionRequest, refs: readonly GitRef[]): ActionPlan {
    if (request.kind === 'fetch_all') return this.fetchAll()
    if (!request.refName) throw new Error('This action requires a repository ref.')
    const ref = refs.find((candidate) => candidate.fullName === request.refName)
    if (ref === undefined) throw new Error('The selected ref no longer exists. Refresh the repository.')

    switch (request.kind) {
      case 'switch_branch':
        if (ref.kind !== 'local_branch') throw new Error('Only local branches can be switched directly.')
        return this.switchBranch(ref)
      case 'track_remote':
        if (ref.kind !== 'remote_branch') throw new Error('Only remote branches can be tracked.')
        return this.trackRemote(ref)
      case 'fetch_remote':
        if (ref.kind !== 'remote_branch') throw new Error('A remote branch is required for this fetch.')
        return this.fetchRemote(ref)
      default:
        return assertNever(request.kind)
    }
  }

  async execute(repo: string, plan: ActionPlan, status: StatusSnapshot): Promise<CommandResult> {
    if (plan.descriptor.requiresCleanTree && status.isDirty) {
      return {
        argv: ['git', ...plan.argv],
        exitCode: 2,
        stdout: '',
        stderr: 'Working tree has changes. Commit or stash them before this action.'
      }
    }
    return await this.runner.run(plan.argv, { repo, readOnly: false, check: false })
  }

  private fetchAll(): ActionPlan {
    return this.plan('fetch_all', 'Fetch all remotes', 'all remotes', ['fetch', '--all', '--prune', '--tags'])
  }

  private switchBranch(ref: GitRef): ActionPlan {
    return this.plan(
      'switch_branch',
      `Switch to ${ref.shortName}`,
      ref.shortName,
      ['switch', '--', ref.shortName],
      ref.fullName,
      true
    )
  }

  private trackRemote(ref: GitRef): ActionPlan {
    const branch = ref.shortName.includes('/') ? ref.shortName.slice(ref.shortName.indexOf('/') + 1) : ref.shortName
    return this.plan(
      'track_remote',
      `Create local branch ${branch}`,
      ref.shortName,
      ['switch', '--track', '--', ref.shortName],
      ref.fullName,
      true
    )
  }

  private fetchRemote(ref: GitRef): ActionPlan {
    const remote = ref.shortName.split('/', 1)[0]
    return this.plan(
      'fetch_remote',
      `Fetch ${remote}`,
      remote,
      ['fetch', '--prune', '--tags', '--', remote],
      ref.fullName
    )
  }

  private plan(
    kind: GitActionKind,
    label: string,
    target: string,
    argv: string[],
    refName?: string,
    requiresCleanTree = false
  ): ActionPlan {
    return {
      argv,
      descriptor: {
        kind,
        label,
        target,
        command: ['git', ...argv].join(' '),
        refName,
        requiresCleanTree,
        riskLevel: 'normal'
      }
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Git action: ${String(value)}`)
}

