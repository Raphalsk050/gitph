import { contextBridge, ipcRenderer } from 'electron'
import type { GitphApi } from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'

const api: GitphApi = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  openRepository: (path) => ipcRenderer.invoke(IPC_CHANNELS.openRepository, path),
  refreshRepository: () => ipcRenderer.invoke(IPC_CHANNELS.refreshRepository),
  getCommitDetails: (oid) => ipcRenderer.invoke(IPC_CHANNELS.commitDetails, oid),
  listActions: (refName, oid) => ipcRenderer.invoke(IPC_CHANNELS.listActions, refName, oid),
  executeAction: (request) => ipcRenderer.invoke(IPC_CHANNELS.executeAction, request),
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  openDiffWindow: (oid) => ipcRenderer.invoke(IPC_CHANNELS.openDiffWindow, oid),
  isWindowMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized),
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.windowToggleMaximize),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.windowClose),
  onWindowMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on(IPC_CHANNELS.windowMaximizedChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizedChanged, listener)
  }
}

contextBridge.exposeInMainWorld('gitph', api)

