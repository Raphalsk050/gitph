import type { CommitDetails, CommitSummary, RepositorySnapshot } from '../../shared/contracts'
import { GitCommandRunner } from './command-runner'
import { GitGraphBuilder } from './graph'
import {
  parseChangedFiles,
  parseCommits,
  parseRefs,
  parseRemoteNames,
  parseRepoIdentity,
  parseStatus
} from './parser'

export interface LoadedRepository {
  snapshot: RepositorySnapshot
  commits: Map<string, CommitSummary>
}

const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objecttype)',
  '%(objectname)',
  '%(*objecttype)',
  '%(*objectname)',
  '%(HEAD)',
  '%(upstream)',
  '%(upstream:short)',
  '%(creatordate:unix)',
  '%(subject)'
].join('%00') + '%1e'

const LOG_FORMAT = '%x1f%H%x00%P%x00%at%x00%ct%x00%an%x00%ae%x00%s%x1e'

/**
 * @brief Coordinates repository reads and produces immutable renderer snapshots.
 *
 * Responsibility: translate Git CLI output into domain DTOs, schedule independent
 * reads concurrently, and retain commit lookup data only in the trusted process.
 */
export class RepositoryService {
  private readonly runner: GitCommandRunner
  private readonly graphBuilder: GitGraphBuilder

  constructor(runner: GitCommandRunner, graphBuilder = new GitGraphBuilder()) {
    this.runner = runner
    this.graphBuilder = graphBuilder
  }

  async loadSnapshot(path: string): Promise<LoadedRepository> {
    const identity = await this.discover(path)
    const [statusResult, refsResult, commitsResult, remotesResult] = await Promise.all([
      this.runner.run(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
        repo: identity.root
      }),
      this.runner.run(
        [
          'for-each-ref',
          '--sort=refname',
          `--format=${REF_FORMAT}`,
          'refs/heads',
          'refs/remotes',
          'refs/tags',
          'refs/stash'
        ],
        { repo: identity.root }
      ),
      // The full history is loaded; the renderer virtualizes the list so row
      // count no longer bounds rendering cost. `git log` streams the whole graph
      // in one pass, which stays fast even for very large repositories.
      this.runner.run(
        ['log', '--topo-order', '--all', `--pretty=format:${LOG_FORMAT}`],
        { repo: identity.root, check: false, timeoutMs: 120_000 }
      ),
      this.runner.run(['remote'], { repo: identity.root })
    ])

    const status = parseStatus(statusResult.stdout)
    const refs = parseRefs(refsResult.stdout)
    const remotes = parseRemoteNames(remotesResult.stdout)
    const commits = commitsResult.exitCode === 0 ? parseCommits(commitsResult.stdout) : []
    const graph = this.graphBuilder.build(commits, refs)
    return {
      snapshot: { identity, status, remotes, refs, graph },
      commits: new Map(commits.map((commit) => [commit.oid, commit]))
    }
  }

  async loadCommitDetails(repo: string, summary: CommitSummary): Promise<CommitDetails> {
    const [bodyResult, filesResult, patchResult] = await Promise.all([
      this.runner.run(['show', '-s', '--format=%B', summary.oid], { repo, timeoutMs: 20_000 }),
      this.runner.run(['diff-tree', '--root', '-r', '-z', '-M', '--name-status', summary.oid], {
        repo,
        timeoutMs: 20_000
      }),
      this.runner.run(
        [
          'show',
          '--format=',
          '--patch',
          '--find-renames',
          '--no-ext-diff',
          '--no-color',
          '--unified=3',
          summary.oid,
          '--'
        ],
        { repo, timeoutMs: 20_000 }
      )
    ])
    return {
      summary,
      body: bodyResult.stdout.trim(),
      changedFiles: parseChangedFiles(filesResult.stdout),
      patchText: patchResult.stdout
    }
  }

  private async discover(path: string): Promise<RepositorySnapshot['identity']> {
    const revParse = await this.runner.run(
      [
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-dir',
        '--is-bare-repository',
        '--is-inside-work-tree'
      ],
      { repo: path }
    )
    const [headRef, headOid] = await Promise.all([
      this.runner.run(['symbolic-ref', '-q', '--short', 'HEAD'], { repo: path, check: false }),
      this.runner.run(['rev-parse', '--verify', 'HEAD'], { repo: path, check: false })
    ])
    return parseRepoIdentity(
      path,
      revParse.stdout,
      headRef.exitCode === 0 ? headRef.stdout : '',
      headOid.exitCode === 0 ? headOid.stdout : ''
    )
  }
}

