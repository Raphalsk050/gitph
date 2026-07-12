import { watch, type FSWatcher } from 'node:fs'

const DEBOUNCE_MS = 350

/**
 * @brief Watches a repository tree and reports settled changes.
 *
 * Responsibility: turn the burst of filesystem events git and editors produce
 * into a single debounced signal, ignoring the churn (loose objects, reflogs,
 * lock files, dependencies) that never affects the rendered snapshot.
 */
export class RepositoryWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private onChange: (() => void) | null = null

  watch(root: string, onChange: () => void): void {
    this.stop()
    this.onChange = onChange
    try {
      this.watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename && isNoise(filename.toString())) return
        this.schedule()
      })
      // A watch error (permission, unmount) simply disables live updates; the
      // app keeps working with manual refresh.
      this.watcher.on('error', () => this.stop())
    } catch {
      this.watcher = null
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.onChange = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.onChange?.()
    }, DEBOUNCE_MS)
  }
}

/** Paths whose changes never alter the snapshot the renderer shows. */
function isNoise(filename: string): boolean {
  const path = filename.replace(/\\/gu, '/')
  return (
    path.includes('.git/objects/') ||
    path.includes('.git/logs/') ||
    path.includes('node_modules/') ||
    path.startsWith('node_modules') ||
    path.endsWith('.lock')
  )
}
