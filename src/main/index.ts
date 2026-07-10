import { join } from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, Menu } from 'electron'
import type { ActionRequest, IpcResult } from '../shared/contracts'
import { GIT_ACTION_KINDS, IPC_CHANNELS } from '../shared/contracts'
import { GitActionService } from './git/action-service'
import { GitCommandRunner } from './git/command-runner'
import { RepositoryService } from './git/repository-service'
import { RepositoryController } from './repository-controller'
import { SettingsStore } from './settings-store'

let mainWindow: BrowserWindow | null = null

function createBrowserWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    frame: false,
    show: false,
    backgroundColor: '#1f1e1d',
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  const publishMaximized = (): void => {
    window.webContents.send(IPC_CHANNELS.windowMaximizedChanged, window.isMaximized())
  }
  window.on('maximize', publishMaximized)
  window.on('unmaximize', publishMaximized)
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return window
}

function loadRenderer(window: BrowserWindow, hash?: string): void {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(hash ? `${rendererUrl}#${hash}` : rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): BrowserWindow {
  const window = createBrowserWindow({ width: 1480, height: 900, minWidth: 900, minHeight: 620 })
  loadRenderer(window)
  return window
}

function createDiffWindow(oid: string): void {
  const window = createBrowserWindow({ width: 1320, height: 880, minWidth: 780, minHeight: 480 })
  loadRenderer(window, `diff=${oid}`)
}

function registerIpc(controller: RepositoryController): void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, () => safely(() => controller.bootstrap()))
  ipcMain.handle(IPC_CHANNELS.openRepository, (_event, path: unknown) =>
    safely(() => controller.openRepository(optionalString(path, 'repository path')))
  )
  ipcMain.handle(IPC_CHANNELS.refreshRepository, () => safely(() => controller.refresh()))
  ipcMain.handle(IPC_CHANNELS.commitDetails, (_event, oid: unknown) =>
    safely(() => controller.commitDetails(requiredString(oid, 'commit id')))
  )
  ipcMain.handle(IPC_CHANNELS.listActions, (_event, refName: unknown, oid: unknown) =>
    safely(() => controller.listActions(optionalString(refName, 'ref name'), optionalString(oid, 'commit id')))
  )
  ipcMain.handle(IPC_CHANNELS.executeAction, (_event, request: unknown) =>
    safely(() => controller.executeAction(requiredActionRequest(request)))
  )
  ipcMain.handle(IPC_CHANNELS.copyText, (_event, text: unknown) =>
    safely(() => {
      const value = requiredString(text, 'clipboard text')
      if (value.length > 1_000_000) throw new Error('Clipboard payload is too large.')
      clipboard.writeText(value)
    })
  )
  ipcMain.handle(IPC_CHANNELS.openDiffWindow, (_event, oid: unknown) =>
    safely(() => {
      const value = requiredString(oid, 'commit id')
      if (!/^[0-9a-f]{4,40}$/iu.test(value)) throw new Error('Invalid commit id.')
      createDiffWindow(value)
    })
  )
  ipcMain.handle(IPC_CHANNELS.windowIsMaximized, (event) =>
    safely(() => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  )

  ipcMain.on(IPC_CHANNELS.windowMinimize, (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on(IPC_CHANNELS.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC_CHANNELS.windowClose, (event) => BrowserWindow.fromWebContents(event.sender)?.close())
}

async function safely<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredString(value, label)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}.`)
  return value
}

function requiredActionRequest(value: unknown): ActionRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Git action request.')
  const request = value as Partial<ActionRequest>
  const kinds = new Set<string>(GIT_ACTION_KINDS)
  if (typeof request.kind !== 'string' || !kinds.has(request.kind)) {
    throw new Error('Unsupported Git action request.')
  }
  for (const field of ['refName', 'oid', 'name'] as const) {
    if (request[field] !== undefined && typeof request[field] !== 'string') {
      throw new Error(`Invalid action ${field}.`)
    }
  }
  return request as ActionRequest
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  const runner = new GitCommandRunner()
  const controller = new RepositoryController(
    new RepositoryService(runner),
    new GitActionService(runner),
    new SettingsStore(join(app.getPath('userData'), 'settings.json')),
    () => mainWindow
  )
  registerIpc(controller)
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
