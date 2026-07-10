import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface SettingsData {
  recentRepositories: string[]
}

const EMPTY_SETTINGS: SettingsData = { recentRepositories: [] }

/**
 * @brief Persists the small set of user-owned desktop preferences.
 *
 * Responsibility: load and atomically save recent repository paths without
 * leaking persistence concerns into Git services or the renderer.
 */
export class SettingsStore {
  private readonly filePath: string
  private data: SettingsData = EMPTY_SETTINGS
  private loaded = false

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<string[]> {
    if (this.loaded) return [...this.data.recentRepositories]
    this.loaded = true
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (isSettingsData(parsed)) {
        this.data = { recentRepositories: parsed.recentRepositories.slice(0, 8) }
      }
    } catch {
      this.data = EMPTY_SETTINGS
    }
    return [...this.data.recentRepositories]
  }

  async remember(repository: string): Promise<string[]> {
    await this.load()
    const normalized = repository.toLocaleLowerCase()
    this.data = {
      recentRepositories: [
        repository,
        ...this.data.recentRepositories.filter((path) => path.toLocaleLowerCase() !== normalized)
      ].slice(0, 8)
    }
    await this.save()
    return [...this.data.recentRepositories]
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    const payload = JSON.stringify(this.data, null, 2)
    await writeFile(temporaryPath, payload, 'utf8')
    try {
      await rename(temporaryPath, this.filePath)
    } catch {
      await writeFile(this.filePath, payload, 'utf8')
      await rm(temporaryPath, { force: true })
    }
  }
}

function isSettingsData(value: unknown): value is SettingsData {
  if (typeof value !== 'object' || value === null) return false
  const repositories = (value as Partial<SettingsData>).recentRepositories
  return Array.isArray(repositories) && repositories.every((path) => typeof path === 'string')
}

