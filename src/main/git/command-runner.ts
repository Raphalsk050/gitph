import { spawn } from 'node:child_process'

export interface CommandResult {
  argv: string[]
  exitCode: number
  stdout: string
  stderr: string
}

interface RunOptions {
  repo?: string
  timeoutMs?: number
  readOnly?: boolean
  check?: boolean
}

/**
 * @brief Executes bounded Git subprocesses without invoking a shell.
 *
 * Responsibility: enforce explicit arguments, timeouts, output limits, and a
 * read-only environment boundary for every Git process owned by the app.
 */
export class GitCommandRunner {
  private readonly timeoutMs: number
  private readonly maxOutputBytes: number

  constructor(timeoutMs = 30_000, maxOutputBytes = 64 * 1024 * 1024) {
    this.timeoutMs = timeoutMs
    this.maxOutputBytes = maxOutputBytes
  }

  async run(args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    const readOnly = options.readOnly ?? true
    const argv = this.buildArguments(args, options.repo, readOnly)
    const displayArgv = ['git', ...argv]

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn('git', argv, {
        env: readOnly ? { ...process.env, GIT_OPTIONAL_LOCKS: '0' } : process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let outputBytes = 0
      let failure: string | null = null
      let settled = false

      const finishWithError = (message: string): void => {
        if (failure === null) {
          failure = message
          child.kill()
        }
      }

      const collect = (target: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.byteLength
        if (outputBytes > this.maxOutputBytes) {
          finishWithError(`Git output exceeded ${this.maxOutputBytes} bytes.`)
          return
        }
        target.push(chunk)
      }

      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk))
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk))

      const timeout = setTimeout(() => {
        finishWithError(`Git command timed out after ${options.timeoutMs ?? this.timeoutMs} ms.`)
      }, options.timeoutMs ?? this.timeoutMs)

      child.once('error', (error) => {
        clearTimeout(timeout)
        if (settled) return
        settled = true
        reject(new Error(`Unable to start Git: ${error.message}`))
      })

      child.once('close', (code) => {
        clearTimeout(timeout)
        if (settled) return
        settled = true
        const result: CommandResult = {
          argv: displayArgv,
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: failure ?? Buffer.concat(stderr).toString('utf8')
        }
        if (failure !== null || ((options.check ?? true) && result.exitCode !== 0)) {
          reject(new GitCommandError(result))
          return
        }
        resolve(result)
      })
    })
  }

  private buildArguments(args: readonly string[], repo: string | undefined, readOnly: boolean): string[] {
    const argv: string[] = []
    if (readOnly) argv.push('--no-optional-locks')
    if (repo !== undefined) argv.push('-C', repo)
    argv.push(...args)
    return argv
  }
}

/**
 * @brief Carries a failed Git command and its decoded process result.
 *
 * Responsibility: preserve diagnostics while exposing a concise recoverable
 * error to the IPC boundary.
 */
export class GitCommandError extends Error {
  readonly result: CommandResult

  constructor(result: CommandResult) {
    super(result.stderr.trim() || result.stdout.trim() || 'Git command failed.')
    this.name = 'GitCommandError'
    this.result = result
  }
}

