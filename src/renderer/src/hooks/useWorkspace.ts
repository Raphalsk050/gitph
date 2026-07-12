import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActionDescriptor,
  CommitDetails,
  CommitRequest,
  IpcResult,
  RepositorySnapshot,
  WorkingDiffRequest,
  WorkspacePayload
} from '@shared/contracts'

interface WorkspaceController {
  snapshot: RepositorySnapshot | null
  recentRepositories: string[]
  selectedOid: string | null
  details: CommitDetails | null
  loading: boolean
  loadingDetails: boolean
  status: string
  error: string | null
  openRepository(path?: string): Promise<void>
  refresh(): Promise<void>
  selectCommit(oid: string): Promise<void>
  listActions(refName?: string, oid?: string): Promise<ActionDescriptor[]>
  runAction(action: ActionDescriptor, name?: string): Promise<boolean>
  stageEntries(paths: string[]): Promise<boolean>
  unstageEntries(paths: string[]): Promise<boolean>
  discardEntries(paths: string[]): Promise<boolean>
  commitChanges(request: CommitRequest): Promise<boolean>
  loadWorkingDiff(request: WorkingDiffRequest): Promise<string | null>
  copyText(text: string): Promise<boolean>
  clearError(): void
}

export function useWorkspace(): WorkspaceController {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null)
  const [recentRepositories, setRecentRepositories] = useState<string[]>([])
  const [selectedOid, setSelectedOid] = useState<string | null>(null)
  const [details, setDetails] = useState<CommitDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [status, setStatus] = useState('Starting Gitph…')
  const [error, setError] = useState<string | null>(null)
  const selectedOidRef = useRef<string | null>(null)
  const detailRequest = useRef(0)

  const clearError = useCallback(() => setError(null), [])

  const acceptWorkspace = useCallback((workspace: WorkspacePayload): string | null => {
    setRecentRepositories(workspace.recentRepositories)
    setSnapshot(workspace.snapshot)
    setDetails(null)
    detailRequest.current += 1

    if (workspace.snapshot === null) {
      selectedOidRef.current = null
      setSelectedOid(null)
      setStatus('Open a Git repository to get started')
      return null
    }

    const previous = selectedOidRef.current
    const stillExists = workspace.snapshot.graph.rows.some((row) => row.commit.oid === previous)
    const next = stillExists ? previous : (workspace.snapshot.graph.rows[0]?.commit.oid ?? null)
    selectedOidRef.current = next
    setSelectedOid(next)
    setStatus(
      `${workspace.snapshot.graph.rows.length} commits · ${workspace.snapshot.status.entries.length} changed files`
    )
    return next
  }, [])

  const selectCommit = useCallback(async (oid: string): Promise<void> => {
    selectedOidRef.current = oid
    setSelectedOid(oid)
    setLoadingDetails(true)
    setStatus(`Loading ${oid.slice(0, 8)}…`)
    const request = ++detailRequest.current
    const result = await window.gitph.getCommitDetails(oid)
    if (request !== detailRequest.current) return
    setLoadingDetails(false)
    if (!result.ok) {
      setError(result.error)
      setStatus(`Could not load ${oid.slice(0, 8)}`)
      return
    }
    setDetails(result.value)
    setStatus(`Selected ${oid.slice(0, 8)}`)
  }, [])

  const finishWorkspaceOperation = useCallback(
    async (result: IpcResult<WorkspacePayload>, fallbackStatus: string): Promise<void> => {
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setStatus(result.error)
        return
      }
      if (result.value.cancelled) {
        setStatus(fallbackStatus)
        return
      }
      const next = acceptWorkspace(result.value)
      if (next !== null) await selectCommit(next)
    },
    [acceptWorkspace, selectCommit]
  )

  const openRepository = useCallback(
    async (path?: string): Promise<void> => {
      setLoading(true)
      setError(null)
      setStatus('Opening repository…')
      await finishWorkspaceOperation(
        await window.gitph.openRepository(path),
        snapshot ? `Ready · ${snapshot.graph.rows.length} commits` : 'Open a Git repository to get started'
      )
    },
    [finishWorkspaceOperation, snapshot]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (snapshot === null) return
    setLoading(true)
    setError(null)
    setStatus('Refreshing repository…')
    await finishWorkspaceOperation(await window.gitph.refreshRepository(), 'Refresh cancelled')
  }, [finishWorkspaceOperation, snapshot])

  const listActions = useCallback(async (refName?: string, oid?: string): Promise<ActionDescriptor[]> => {
    const result = await window.gitph.listActions(refName, oid)
    if (!result.ok) {
      setError(result.error)
      return []
    }
    return result.value
  }, [])

  const runAction = useCallback(
    async (action: ActionDescriptor, name?: string): Promise<boolean> => {
      setLoading(true)
      setError(null)
      setStatus(`Running ${action.command}…`)
      const result = await window.gitph.executeAction({
        kind: action.kind,
        refName: action.refName,
        remoteName: action.remoteName,
        oid: action.oid,
        name
      })
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setStatus(result.error)
        return false
      }
      if (result.value.exitCode !== 0) {
        const message = result.value.stderr.trim() || result.value.stdout.trim() || `${action.label} failed.`
        setError(message)
        setStatus(message)
        return false
      }
      const next = result.value.workspace ? acceptWorkspace(result.value.workspace) : null
      setStatus(result.value.stdout.trim() || `${action.label} completed`)
      if (next !== null) await selectCommit(next)
      return true
    },
    [acceptWorkspace, selectCommit]
  )

  // Working-tree mutations keep the current selection: the changes panel stays
  // put while staging, so only the snapshot (and thus the file list) refreshes.
  const applyWorkspace = useCallback((workspace: WorkspacePayload): void => {
    setRecentRepositories(workspace.recentRepositories)
    setSnapshot(workspace.snapshot)
    if (workspace.snapshot) {
      setStatus(
        `${workspace.snapshot.graph.rows.length} commits · ${workspace.snapshot.status.entries.length} changed files`
      )
    }
  }, [])

  const mutateWorkingTree = useCallback(
    async (
      operation: () => Promise<IpcResult<WorkspacePayload>>,
      pending: string
    ): Promise<boolean> => {
      setLoading(true)
      setError(null)
      setStatus(pending)
      const result = await operation()
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setStatus(result.error)
        return false
      }
      applyWorkspace(result.value)
      return true
    },
    [applyWorkspace]
  )

  const stageEntries = useCallback(
    (paths: string[]): Promise<boolean> =>
      mutateWorkingTree(() => window.gitph.stageEntries(paths), 'Staging changes…'),
    [mutateWorkingTree]
  )

  const unstageEntries = useCallback(
    (paths: string[]): Promise<boolean> =>
      mutateWorkingTree(() => window.gitph.unstageEntries(paths), 'Unstaging changes…'),
    [mutateWorkingTree]
  )

  const discardEntries = useCallback(
    (paths: string[]): Promise<boolean> =>
      mutateWorkingTree(() => window.gitph.discardEntries(paths), 'Discarding changes…'),
    [mutateWorkingTree]
  )

  const commitChanges = useCallback(
    async (request: CommitRequest): Promise<boolean> => {
      setLoading(true)
      setError(null)
      setStatus('Committing…')
      const result = await window.gitph.commitChanges(request)
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setStatus(result.error)
        return false
      }
      if (result.value.exitCode !== 0) {
        const message = result.value.stderr.trim() || result.value.stdout.trim() || 'Commit failed.'
        setError(message)
        setStatus(message)
        return false
      }
      if (result.value.workspace) {
        // Land on the commit we just created rather than the prior selection.
        acceptWorkspace(result.value.workspace)
        const head = result.value.workspace.snapshot?.identity.headOid ?? null
        setStatus('Commit created')
        if (head !== null) await selectCommit(head)
      }
      return true
    },
    [acceptWorkspace, selectCommit]
  )

  const loadWorkingDiff = useCallback(async (request: WorkingDiffRequest): Promise<string | null> => {
    const result = await window.gitph.getWorkingDiff(request)
    if (!result.ok) {
      setError(result.error)
      return null
    }
    return result.value
  }, [])

  const copyText = useCallback(async (text: string): Promise<boolean> => {
    const result = await window.gitph.copyText(text)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    setStatus('Copied to clipboard')
    return true
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const result = await window.gitph.bootstrap()
      if (!active) return
      setLoading(false)
      if (!result.ok) {
        setError(result.error)
        setStatus(result.error)
        return
      }
      const next = acceptWorkspace(result.value)
      if (next !== null) await selectCommit(next)
    })()
    return () => {
      active = false
      detailRequest.current += 1
    }
  }, [acceptWorkspace, selectCommit])

  return {
    snapshot,
    recentRepositories,
    selectedOid,
    details,
    loading,
    loadingDetails,
    status,
    error,
    openRepository,
    refresh,
    selectCommit,
    listActions,
    runAction,
    stageEntries,
    unstageEntries,
    discardEntries,
    commitChanges,
    loadWorkingDiff,
    copyText,
    clearError
  }
}

