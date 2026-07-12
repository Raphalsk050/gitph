import type { CommandResult } from './command-runner'
import { GitCommandRunner } from './command-runner'

const OK: CommandResult = { argv: ['git'], exitCode: 0, stdout: '', stderr: '' }

/**
 * @brief Owns the mutating working-tree operations behind the changes panel.
 *
 * Responsibility: stage, unstage, discard and commit files the controller has
 * already verified against the loaded status snapshot, and read per-file diffs.
 * Every argument vector is built here from trusted paths; the renderer never
 * supplies raw argv. Paths are always passed after `--` so a filename can never
 * be parsed as a flag.
 */
export class GitWorkingTreeService {
  private readonly runner: GitCommandRunner

  constructor(runner: GitCommandRunner) {
    this.runner = runner
  }

  stage(repo: string, paths: readonly string[]): Promise<CommandResult> {
    if (paths.length === 0) return Promise.resolve(OK)
    return this.mutate(repo, ['add', '--', ...paths])
  }

  stageAll(repo: string): Promise<CommandResult> {
    return this.mutate(repo, ['add', '--all'])
  }

  unstage(repo: string, paths: readonly string[]): Promise<CommandResult> {
    if (paths.length === 0) return Promise.resolve(OK)
    return this.mutate(repo, ['restore', '--staged', '--', ...paths])
  }

  /**
   * Reverts tracked files to HEAD (dropping both staged and worktree changes)
   * and deletes untracked files. Runs as two steps and stops at the first
   * failure so a partial discard still surfaces its error.
   */
  async discard(
    repo: string,
    tracked: readonly string[],
    untracked: readonly string[],
    hasHead: boolean
  ): Promise<CommandResult> {
    if (tracked.length > 0) {
      const args = hasHead
        ? ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked]
        : ['restore', '--staged', '--', ...tracked]
      const result = await this.mutate(repo, args)
      if (result.exitCode !== 0) return result
    }
    if (untracked.length > 0) {
      const result = await this.mutate(repo, ['clean', '-f', '-d', '--', ...untracked])
      if (result.exitCode !== 0) return result
    }
    return OK
  }

  commit(repo: string, summary: string, description: string | undefined, amend: boolean): Promise<CommandResult> {
    const args = ['commit', '-m', summary]
    if (description) args.push('-m', description)
    if (amend) args.push('--amend')
    return this.mutate(repo, args)
  }

  diff(repo: string, path: string, staged: boolean, untracked: boolean): Promise<CommandResult> {
    if (untracked) {
      // An untracked file has no index entry, so compare it against /dev/null
      // (git treats that path specially on every platform). Exit code 1 just
      // means "files differ", which is the expected result here.
      return this.runner.run(
        ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
        { repo, check: false }
      )
    }
    const args = ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--unified=3']
    if (staged) args.push('--cached')
    args.push('--', path)
    return this.runner.run(args, { repo, check: false })
  }

  private mutate(repo: string, args: string[]): Promise<CommandResult> {
    return this.runner.run(args, { repo, readOnly: false, check: false })
  }
}
