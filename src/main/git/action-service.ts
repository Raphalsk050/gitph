import type {
  ActionDescriptor,
  ActionRequest,
  CommitSummary,
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

const NAME_TOKEN = '<name>'

/**
 * @brief Owns the allowlisted set of mutating Git operations.
 *
 * Responsibility: rebuild every requested action from trusted repository refs
 * and commits, enforce clean-tree preconditions, and prevent renderer-controlled
 * argv. User-provided ref names are validated before they reach an argument
 * vector; commit ids must exist in the loaded graph.
 */
export class GitActionService {
  private readonly runner: GitCommandRunner

  constructor(runner: GitCommandRunner) {
    this.runner = runner
  }

  listActions(ref: GitRef | undefined, refs: readonly GitRef[], remotes: readonly string[]): ActionDescriptor[] {
    if (ref === undefined) {
      return [this.fetchAll(), this.pullFf(), this.pushHead()].map((plan) => plan.descriptor)
    }
    if (ref.kind === 'local_branch') {
      return this.localBranchPlans(ref, refs, remotes).map((plan) => plan.descriptor)
    }
    if (ref.kind === 'remote_branch') {
      return [this.trackRemote(ref).descriptor, this.fetchRemote(ref).descriptor]
    }
    if (ref.kind === 'tag') {
      return [this.checkoutTag(ref).descriptor, this.deleteTag(ref).descriptor]
    }
    return []
  }

  listCommitActions(commit: CommitSummary): ActionDescriptor[] {
    return [
      this.createBranch(commit),
      this.createTag(commit),
      this.checkoutCommit(commit),
      this.cherryPick(commit),
      this.revertCommit(commit),
      this.resetToCommit(commit, 'reset_soft'),
      this.resetToCommit(commit, 'reset_mixed'),
      this.resetToCommit(commit, 'reset_hard')
    ].map((plan) => plan.descriptor)
  }

  resolve(
    request: ActionRequest,
    refs: readonly GitRef[],
    remotes: readonly string[],
    commits: ReadonlyMap<string, CommitSummary>
  ): ActionPlan {
    switch (request.kind) {
      case 'fetch_all':
        return this.fetchAll()
      case 'pull_ff':
        return this.pullFf()
      case 'push_head':
        return this.pushHead()
      case 'push_branch':
        return this.pushBranch(this.requireRef(request, refs, 'local_branch'))
      case 'rename_branch':
        return this.renameBranch(this.requireRef(request, refs, 'local_branch'), validateRefName(request.name))
      case 'publish_branch':
        return this.publishBranch(
          this.requireRef(request, refs, 'local_branch'),
          this.requireRemote(request, remotes)
        )
      case 'switch_branch':
        return this.switchBranch(this.requireRef(request, refs, 'local_branch'))
      case 'merge_branch':
        return this.mergeBranch(this.requireRef(request, refs, 'local_branch'))
      case 'rebase_onto_branch':
        return this.rebaseOntoBranch(this.requireRef(request, refs, 'local_branch'))
      case 'delete_branch':
        return this.deleteBranch(this.requireRef(request, refs, 'local_branch'))
      case 'track_remote':
        return this.trackRemote(this.requireRef(request, refs, 'remote_branch'))
      case 'fetch_remote':
        return this.fetchRemote(this.requireRef(request, refs, 'remote_branch'))
      case 'checkout_tag':
        return this.checkoutTag(this.requireRef(request, refs, 'tag'))
      case 'delete_tag':
        return this.deleteTag(this.requireRef(request, refs, 'tag'))
      case 'checkout_commit':
        return this.checkoutCommit(this.requireCommit(request, commits))
      case 'cherry_pick':
        return this.cherryPick(this.requireCommit(request, commits))
      case 'revert_commit':
        return this.revertCommit(this.requireCommit(request, commits))
      case 'reset_soft':
      case 'reset_mixed':
      case 'reset_hard':
        return this.resetToCommit(this.requireCommit(request, commits), request.kind)
      case 'create_branch':
        return this.createBranch(this.requireCommit(request, commits), validateRefName(request.name))
      case 'create_tag':
        return this.createTag(this.requireCommit(request, commits), validateRefName(request.name))
      default:
        return assertNever(request.kind)
    }
  }

  async execute(repo: string, plan: ActionPlan, status: StatusSnapshot): Promise<CommandResult> {
    if (plan.argv.includes(NAME_TOKEN)) {
      throw new Error('This action requires a name before it can run.')
    }
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

  private requireRef(request: ActionRequest, refs: readonly GitRef[], kind: GitRef['kind']): GitRef {
    if (!request.refName) throw new Error('This action requires a repository ref.')
    const ref = refs.find((candidate) => candidate.fullName === request.refName)
    if (ref === undefined) throw new Error('The selected ref no longer exists. Refresh the repository.')
    if (ref.kind !== kind) throw new Error(`This action requires a ${kind.replace('_', ' ')}.`)
    return ref
  }

  private requireCommit(request: ActionRequest, commits: ReadonlyMap<string, CommitSummary>): CommitSummary {
    if (!request.oid) throw new Error('This action requires a commit.')
    const commit = commits.get(request.oid)
    if (commit === undefined) throw new Error('The commit is not part of the current graph. Refresh the repository.')
    return commit
  }

  private requireRemote(request: ActionRequest, remotes: readonly string[]): string {
    if (!request.remoteName) throw new Error('This action requires a remote.')
    if (!remotes.includes(request.remoteName)) {
      throw new Error('The selected remote no longer exists. Refresh the repository.')
    }
    return request.remoteName
  }

  private fetchAll(): ActionPlan {
    return this.plan('fetch_all', 'Fetch all remotes', 'all remotes', ['fetch', '--all', '--prune', '--tags'])
  }

  private pullFf(): ActionPlan {
    return this.plan('pull_ff', 'Pull (fast-forward only)', 'current branch', ['pull', '--ff-only'], {
      requiresCleanTree: true
    })
  }

  private pushHead(): ActionPlan {
    return this.plan('push_head', 'Push current branch', 'upstream', ['push'])
  }

  /**
   * The full action set GitKraken offers on a local branch. For a branch that
   * only exists locally the publish plan is the "push" (it pushes and sets the
   * upstream); once tracked, a plain push/pull applies. Merge, rebase, rename
   * and delete round out the branch operations, mirroring GitKraken's menu.
   */
  private localBranchPlans(ref: GitRef, refs: readonly GitRef[], remotes: readonly string[]): ActionPlan[] {
    const publishPlans = this.publishPlans(ref, refs, remotes)
    const plans: ActionPlan[] = []

    // Push: publish (set upstream) while local-only, otherwise a real push.
    if (publishPlans.length > 0) plans.push(...publishPlans)
    else if (ref.isHead) plans.push(this.pushHead())
    else if (ref.upstream) plans.push(this.pushBranch(ref))

    if (ref.isHead) {
      if (publishPlans.length === 0) plans.push(this.pullFf())
    } else {
      plans.push(this.switchBranch(ref), this.mergeBranch(ref), this.rebaseOntoBranch(ref))
    }

    plans.push(this.renameBranch(ref))
    if (!ref.isHead) plans.push(this.deleteBranch(ref))
    return plans
  }

  private publishPlans(ref: GitRef, refs: readonly GitRef[], remotes: readonly string[]): ActionPlan[] {
    return this.publishCandidates(ref, remotes)
      .filter((remote) => !refs.some((candidate) => candidate.fullName === `refs/remotes/${remote}/${ref.shortName}`))
      .map((remote) => this.publishBranch(ref, remote))
  }

  private publishCandidates(ref: GitRef, remotes: readonly string[]): string[] {
    if (ref.upstream) {
      const upstreamRemote = [...remotes]
        .sort((left, right) => right.length - left.length)
        .find((remote) => ref.upstream === remote || ref.upstream?.startsWith(`${remote}/`))
      if (upstreamRemote) return [upstreamRemote]
    }
    if (remotes.includes('origin')) return ['origin']
    if (remotes.length === 1) return [remotes[0]]
    return [...remotes]
  }

  private publishBranch(ref: GitRef, remote: string): ActionPlan {
    return this.plan(
      'publish_branch',
      `Publish ${ref.shortName} to ${remote}`,
      remote,
      ['push', '--set-upstream', `--repo=${remote}`, `${ref.fullName}:${ref.fullName}`],
      { refName: ref.fullName, remoteName: remote }
    )
  }

  private switchBranch(ref: GitRef): ActionPlan {
    return this.plan('switch_branch', `Switch to ${ref.shortName}`, ref.shortName, ['switch', '--', ref.shortName], {
      refName: ref.fullName,
      requiresCleanTree: true
    })
  }

  private mergeBranch(ref: GitRef): ActionPlan {
    return this.plan(
      'merge_branch',
      `Merge ${ref.shortName} into current branch`,
      ref.shortName,
      ['merge', '--', ref.shortName],
      { refName: ref.fullName, requiresCleanTree: true, riskLevel: 'high' }
    )
  }

  private rebaseOntoBranch(ref: GitRef): ActionPlan {
    return this.plan(
      'rebase_onto_branch',
      `Rebase current branch onto ${ref.shortName}`,
      ref.shortName,
      ['rebase', ref.shortName],
      { refName: ref.fullName, requiresCleanTree: true, riskLevel: 'high' }
    )
  }

  /**
   * Pushes a specific local branch to its configured upstream. Unlike
   * `pushHead` this works when the branch is not currently checked out, using an
   * explicit refspec so only the named branch is pushed.
   */
  private pushBranch(ref: GitRef): ActionPlan {
    const separator = ref.upstream?.indexOf('/') ?? -1
    const remote = separator > 0 ? ref.upstream!.slice(0, separator) : (ref.upstream ?? '')
    const remoteBranch = separator > 0 ? ref.upstream!.slice(separator + 1) : ref.shortName
    return this.plan(
      'push_branch',
      `Push ${ref.shortName}`,
      remote,
      ['push', '--', remote, `refs/heads/${ref.shortName}:refs/heads/${remoteBranch}`],
      { refName: ref.fullName, remoteName: remote }
    )
  }

  private renameBranch(ref: GitRef, name?: string): ActionPlan {
    return this.plan(
      'rename_branch',
      `Rename ${ref.shortName}`,
      ref.shortName,
      ['branch', '--move', ref.shortName, name ?? NAME_TOKEN],
      { refName: ref.fullName, requiresName: true, namePlaceholder: 'new branch name' }
    )
  }

  private deleteBranch(ref: GitRef): ActionPlan {
    return this.plan(
      'delete_branch',
      `Delete branch ${ref.shortName}`,
      ref.shortName,
      ['branch', '--delete', '--', ref.shortName],
      { refName: ref.fullName, riskLevel: 'high' }
    )
  }

  private trackRemote(ref: GitRef): ActionPlan {
    const branch = ref.shortName.includes('/') ? ref.shortName.slice(ref.shortName.indexOf('/') + 1) : ref.shortName
    return this.plan(
      'track_remote',
      `Create local branch ${branch}`,
      ref.shortName,
      ['switch', '--track', '--', ref.shortName],
      { refName: ref.fullName, requiresCleanTree: true }
    )
  }

  private fetchRemote(ref: GitRef): ActionPlan {
    const remote = ref.shortName.split('/', 1)[0]
    return this.plan('fetch_remote', `Fetch ${remote}`, remote, ['fetch', '--prune', '--tags', '--', remote], {
      refName: ref.fullName
    })
  }

  private checkoutTag(ref: GitRef): ActionPlan {
    return this.plan(
      'checkout_tag',
      `Checkout tag ${ref.shortName} (detached)`,
      ref.shortName,
      ['switch', '--detach', ref.displayOid],
      { refName: ref.fullName, requiresCleanTree: true }
    )
  }

  private deleteTag(ref: GitRef): ActionPlan {
    return this.plan('delete_tag', `Delete tag ${ref.shortName}`, ref.shortName, ['tag', '--delete', '--', ref.shortName], {
      refName: ref.fullName,
      riskLevel: 'high'
    })
  }

  private checkoutCommit(commit: CommitSummary): ActionPlan {
    return this.plan(
      'checkout_commit',
      `Checkout ${quoteSubject(commit)} (detached)`,
      commit.shortOid,
      ['switch', '--detach', commit.oid],
      { oid: commit.oid, requiresCleanTree: true }
    )
  }

  private createBranch(commit: CommitSummary, name?: string): ActionPlan {
    return this.plan(
      'create_branch',
      `Create branch at ${quoteSubject(commit)}`,
      commit.shortOid,
      ['branch', '--', name ?? NAME_TOKEN, commit.oid],
      { oid: commit.oid, requiresName: true, namePlaceholder: 'branch name' }
    )
  }

  private createTag(commit: CommitSummary, name?: string): ActionPlan {
    return this.plan(
      'create_tag',
      `Create tag at ${quoteSubject(commit)}`,
      commit.shortOid,
      ['tag', '--', name ?? NAME_TOKEN, commit.oid],
      { oid: commit.oid, requiresName: true, namePlaceholder: 'tag name' }
    )
  }

  private cherryPick(commit: CommitSummary): ActionPlan {
    return this.plan('cherry_pick', `Cherry-pick ${quoteSubject(commit)}`, commit.shortOid, ['cherry-pick', commit.oid], {
      oid: commit.oid,
      requiresCleanTree: true,
      riskLevel: 'high'
    })
  }

  private revertCommit(commit: CommitSummary): ActionPlan {
    return this.plan('revert_commit', `Revert ${quoteSubject(commit)}`, commit.shortOid, ['revert', '--no-edit', commit.oid], {
      oid: commit.oid,
      requiresCleanTree: true,
      riskLevel: 'high'
    })
  }

  private resetToCommit(commit: CommitSummary, kind: 'reset_soft' | 'reset_mixed' | 'reset_hard'): ActionPlan {
    const mode = kind === 'reset_soft' ? '--soft' : kind === 'reset_mixed' ? '--mixed' : '--hard'
    return this.plan(
      kind,
      `Reset to ${quoteSubject(commit)} (${mode.slice(2)})`,
      commit.shortOid,
      ['reset', mode, commit.oid],
      { oid: commit.oid, riskLevel: kind === 'reset_hard' ? 'high' : 'normal' }
    )
  }

  private plan(
    kind: GitActionKind,
    label: string,
    target: string,
    argv: string[],
    options: {
      refName?: string
      remoteName?: string
      oid?: string
      requiresName?: boolean
      namePlaceholder?: string
      requiresCleanTree?: boolean
      riskLevel?: 'normal' | 'high'
    } = {}
  ): ActionPlan {
    return {
      argv,
      descriptor: {
        kind,
        label,
        target,
        command: ['git', ...argv].join(' '),
        refName: options.refName,
        remoteName: options.remoteName,
        oid: options.oid,
        requiresName: options.requiresName,
        namePlaceholder: options.namePlaceholder,
        requiresCleanTree: options.requiresCleanTree ?? false,
        riskLevel: options.riskLevel ?? 'normal'
      }
    }
  }
}

/**
 * Renders a commit's subject as a quoted label fragment. The menu truncates
 * with CSS ellipsis, so the full subject is kept here; the short hash stays
 * available through the "Copy commit hash" action.
 */
function quoteSubject(commit: CommitSummary): string {
  const subject = commit.subject.trim()
  return subject ? `"${subject}"` : commit.shortOid
}

/**
 * Accepts only names git itself would accept for branches and tags, and
 * rejects anything that could be parsed as a flag or path traversal.
 */
function validateRefName(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw new Error('A name is required for this action.')
  if (trimmed.length > 200) throw new Error('The name is too long.')
  for (let index = 0; index < trimmed.length; index += 1) {
    const code = trimmed.charCodeAt(index)
    if (code < 32 || code === 127) throw new Error('Control characters are not allowed in ref names.')
  }
  const forbidden = /[\s~^:?*[\]\\]/u
  if (
    forbidden.test(trimmed) ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.endsWith('.') ||
    trimmed.endsWith('.lock') ||
    trimmed.includes('..') ||
    trimmed.includes('//') ||
    trimmed.includes('@{')
  ) {
    throw new Error(`"${trimmed}" is not a valid ref name.`)
  }
  return trimmed
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Git action: ${String(value)}`)
}
