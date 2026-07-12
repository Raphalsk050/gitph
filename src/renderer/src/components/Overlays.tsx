import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, GitBranch, X, type LucideIcon } from 'lucide-react'
import type { ActionDescriptor } from '@shared/contracts'

export interface ContextMenuItem {
  id: string
  label: string
  /** Section header this item belongs under; a heading is drawn when it changes. */
  group?: string
  /** Leading Lucide glyph shown before the label. */
  icon?: LucideIcon
  /** Right-aligned pill, e.g. a risk badge. */
  badge?: string
  /** Right-aligned muted text, e.g. a keyboard shortcut. */
  detail?: string
  /** Renders the row in the destructive palette. */
  danger?: boolean
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
  let lastGroup: string | undefined
  return (
    <div ref={menu} className="context-menu" style={{ left, top }} role="menu">
      <div className="context-menu-title" title={title}>{title}</div>
      {items.map((item) => {
        const heading = item.group && item.group !== lastGroup ? item.group : null
        lastGroup = item.group
        const Icon = item.icon
        return (
          <div key={item.id}>
            {heading && <div className="context-menu-section">{heading}</div>}
            <button
              type="button"
              role="menuitem"
              className={item.danger ? 'menu-danger' : undefined}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect()
                onClose()
              }}
            >
              {Icon && <Icon className="menu-icon" size={15} aria-hidden />}
              <span className="menu-label">{item.label}</span>
              {item.badge && <em className="menu-badge">{item.badge}</em>}
              {item.detail && <small>{item.detail}</small>}
            </button>
          </div>
        )
      })}
    </div>
  )
}

interface ConfirmDialogProps {
  action: ActionDescriptor
  /** Ref name already collected for actions that require one. */
  name?: string
  busy: boolean
  onConfirm(): void
  onClose(): void
}

export function ConfirmDialog({ action, name, busy, onConfirm, onClose }: ConfirmDialogProps): React.JSX.Element {
  const command = name ? action.command.replace('<name>', name) : action.command
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <button type="button" className="dialog-close" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
        <span className={`confirm-icon${action.riskLevel === 'high' ? ' high-risk' : ''}`}><AlertTriangle size={22} /></span>
        <div>
          <span className="dialog-eyebrow">{action.riskLevel === 'high' ? 'High-impact action' : 'Confirmation required'}</span>
          <h2 id="confirm-title">{action.label}</h2>
        </div>
        <p>This operation will modify <strong>{action.target}</strong>. Gitph will refresh the repository after it completes.</p>
        {action.requiresCleanTree && <div className="clean-tree-warning">A clean working tree is required.</div>}
        <code className="command-preview">{command}</code>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? 'Running…' : 'Run action'}</button>
        </div>
      </section>
    </div>
  )
}

interface PromptDialogProps {
  action: ActionDescriptor
  onSubmit(name: string): void
  onClose(): void
}

/** Collects the ref name for actions like "create branch" or "create tag". */
export function PromptDialog({ action, onSubmit, onClose }: PromptDialogProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const trimmed = value.trim()

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="confirm-dialog prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <span className="confirm-icon"><GitBranch size={22} /></span>
        <div>
          <span className="dialog-eyebrow">Name required</span>
          <h2 id="prompt-title">{action.label}</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed) onSubmit(trimmed)
          }}
        >
          <input
            ref={input}
            className="prompt-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={action.namePlaceholder ?? 'name'}
            aria-label={action.namePlaceholder ?? 'name'}
            spellCheck={false}
          />
          <code className="command-preview">{action.command.replace('<name>', trimmed || (action.namePlaceholder ?? 'name'))}</code>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={!trimmed}>Continue</button>
          </div>
        </form>
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

