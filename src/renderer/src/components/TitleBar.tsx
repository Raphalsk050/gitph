import { useEffect, useState } from 'react'
import { GitBranch, Maximize2, Minus, Square, X } from 'lucide-react'

interface TitleBarProps {
  repositoryName: string | null
}

export function TitleBar({ repositoryName }: TitleBarProps): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    void window.gitph.isWindowMaximized().then((result) => {
      if (active && result.ok) setMaximized(result.value)
    })
    const unsubscribe = window.gitph.onWindowMaximized(setMaximized)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <GitBranch size={14} strokeWidth={2.4} />
        <span>gitph</span>
      </div>
      <div className="titlebar-context">{repositoryName ?? 'Git workspace'}</div>
      <div className="window-controls">
        <button type="button" aria-label="Minimize" onClick={() => window.gitph.minimizeWindow()}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => window.gitph.toggleMaximizeWindow()}
        >
          {maximized ? <Square size={12} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close"
          onClick={() => window.gitph.closeWindow()}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  )
}

