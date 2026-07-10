import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { ActionDescriptor } from '@shared/contracts'

export interface ContextMenuItem {
  id: string
  label: string
  detail?: string
  disabled?: boolean
  onSelect(): void
}

interface ContextMenuProps {
  x: number
  y: number
  title: string
  items: ContextMenuItem[]
  onClose(): void
}

export function ContextMenu({ x, y, title, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - 280))
  const top = Math.max(40, Math.min(y, window.innerHeight - Math.max(120, items.length * 48 + 54)))
  return (
    <div ref={menu} className="context-menu" style={{ left, top }} role="menu">
      <div className="context-menu-title">{title}</div>
      {items.map((item) => (
        <button
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          key={item.id}
        >
          <span>{item.label}</span>
          {item.detail && <small>{item.detail}</small>}
        </button>
      ))}
    </div>
  )
}

interface ConfirmDialogProps {
  action: ActionDescriptor
  busy: boolean
  onConfirm(): void
  onClose(): void
}

export function ConfirmDialog({ action, busy, onConfirm, onClose }: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button type="button" className="dialog-close" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
        <span className="confirm-icon"><AlertTriangle size={22} /></span>
        <div>
          <span className="dialog-eyebrow">Confirmation required</span>
          <h2 id="confirm-title">{action.label}</h2>
        </div>
        <p>This operation will modify <strong>{action.target}</strong>. Gitph will refresh the repository after it completes.</p>
        {action.requiresCleanTree && <div className="clean-tree-warning">A clean working tree is required.</div>}
        <code className="command-preview">{action.command}</code>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? 'Running…' : 'Run action'}</button>
        </div>
      </section>
    </div>
  )
}

export function ErrorToast({ message, onClose }: { message: string; onClose(): void }): React.JSX.Element {
  return (
    <div className="error-toast" role="alert">
      <AlertTriangle size={17} />
      <span>{message}</span>
      <button type="button" aria-label="Dismiss error" onClick={onClose}><X size={15} /></button>
    </div>
  )
}

