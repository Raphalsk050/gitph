import { Plus } from 'lucide-react'
import { LogoMark } from './Logo'

export function EmptyState({ loading, onOpen }: { loading: boolean; onOpen(): void }): React.JSX.Element {
  return (
    <main className="empty-state">
      <div className="empty-illustration">
        <span className="empty-orbit orbit-one" />
        <span className="empty-orbit orbit-two" />
        <LogoMark size={92} />
      </div>
      <span className="empty-kicker">Visual Git workspace</span>
      <h1>See the shape of your history.</h1>
      <p>Open a local repository to explore branches, commits, changed files, and patches in one focused desktop workspace.</p>
      <button type="button" className="primary-button open-repository-button" onClick={onOpen} disabled={loading}>
        <Plus size={18} /> {loading ? 'Opening…' : 'Open repository'}
      </button>
      <small>Ctrl + O</small>
    </main>
  )
}

