import type { GitphApi } from '@shared/contracts'

declare global {
  interface Window {
    gitph: GitphApi
  }
}

export {}

