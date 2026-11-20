import { CodexAction, CodexMessage, CodexResult, CodexState, initialCodexState } from '@root/types/IPC/codex'
import type { CodexBuildAction } from '@root/types/IPC/codex-chat'
import type { CodexDebugAction } from '@root/types/IPC/codex-debug-control'
import { useEffect, useRef, useState } from 'react'

import { openPLCStoreBase } from '../store'
import { createCodexBuildDispatcher } from '../utils/codex-chat-action'
import { buildCodexContext } from '../utils/codex-context'
import { debugObservations } from '../utils/codex-debug'
import { createCodexDebugDispatcher, debugTargetKey } from '../utils/codex-debug-control'
import { createCodexEditDispatcher } from '../utils/codex-direct-edits'
import { clearIoObservation } from '../utils/io-observation'

export function useCodex(
  projectPath: string,
  onBuildRequested: (action: CodexBuildAction) => void,
  onEditRequested: (message: CodexMessage) => void,
  onDebugRequested: (request: { action: CodexDebugAction; target: string }) => void,
) {
  const debugHandler = useRef(onDebugRequested)
  debugHandler.current = onDebugRequested
  const debugDispatcher = useRef(createCodexDebugDispatcher())
  const editHandler = useRef(onEditRequested)
  editHandler.current = onEditRequested
  const editDispatcher = useRef(createCodexEditDispatcher())
  const buildHandler = useRef(onBuildRequested)
  buildHandler.current = onBuildRequested
  const dispatcher = useRef(createCodexBuildDispatcher())
  const latestRevision = useRef(-1)
  const [state, setState] = useState<CodexState>(initialCodexState)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    const accept = (next: CodexState) => {
      if (active && next.revision >= latestRevision.current) {
        latestRevision.current = next.revision
        setState((previous) => (next.revision >= previous.revision ? next : previous))
        const request = dispatcher.current.take(next)
        if (request) buildHandler.current(request)
        const edit = editDispatcher.current.take(next)
        if (edit) editHandler.current(edit)
        const debug = debugDispatcher.current.take(next, debugTargetKey(openPLCStoreBase.getState()))
        if (debug) debugHandler.current(debug)
      }
    }
    const unsubscribe = window.bridge.onCodexState(accept)
    void window.bridge
      .codexSetProject(projectPath)
      .then((result) => accept(result.state))
      .catch(() => {
        if (active) setLocalError('Could not reach the Codex service. Restart the editor.')
      })
    return () => {
      active = false
      dispatcher.current.clear()
      editDispatcher.current.clear()
      debugDispatcher.current.clear()
      unsubscribe()
      clearIoObservation(projectPath)
      void window.bridge.codexSetProject(null).catch(() => {})
    }
  }, [projectPath])

  const invoke = async (request: () => Promise<CodexResult>) => {
    setPending(true)
    setLocalError(null)
    try {
      const result = await request()
      setState((previous) => (result.state.revision >= previous.revision ? result.state : previous))
      if (!result.success) {
        debugDispatcher.current.clear()
        dispatcher.current.clear()
        editDispatcher.current.clear()
        setLocalError(result.error ?? 'Codex request failed.')
      }
      return result.success
    } catch (error) {
      debugDispatcher.current.clear()
      dispatcher.current.clear()
      editDispatcher.current.clear()
      setLocalError(error instanceof Error ? error.message : 'Could not reach the Codex service. Restart the editor.')
      return false
    } finally {
      setPending(false)
    }
  }
  return {
    state,
    error: localError ?? state.error,
    pending,
    action: (action: CodexAction) => {
      debugDispatcher.current.clear()
      dispatcher.current.clear()
      editDispatcher.current.clear()
      return invoke(() => window.bridge.codexAction(action))
    },
    selectRuntime: () => invoke(() => window.bridge.codexSelectRuntime()),
    analyzeDebugResult: (model: string) =>
      invoke(() => {
        const current = openPLCStoreBase.getState()
        if (current.project.meta.path !== projectPath) throw new Error('Project changed.')
        return window.bridge.codexSend({
          projectPath,
          model,
          context: buildCodexContext(current),
          debugFollowup: true,
          text: 'Automatic debugger result: analyze the host result of the preceding requested action. Explain observed values, limitations and any error. Do not execute further actions.',
        })
      }),
    send: (
      text: string,
      model: string,
      includeContext: boolean,
      proposeChanges = false,
      includeDebugger = false,
      directEdits = false,
      activeDebugger = false,
    ) =>
      invoke(() => {
        const current = openPLCStoreBase.getState()
        if (current.project.meta.path !== projectPath) throw new Error('The active project changed. Please retry.')
        const context = includeContext ? buildCodexContext(current) : undefined
        const buildRequestId = includeContext && proposeChanges ? crypto.randomUUID() : undefined
        const applyRequestId = includeContext && proposeChanges && directEdits ? crypto.randomUUID() : undefined
        const debugRequestId = includeContext && activeDebugger ? crypto.randomUUID() : undefined
        debugDispatcher.current.clear()
        if (debugRequestId) debugDispatcher.current.arm(debugRequestId, projectPath, debugTargetKey(current))
        dispatcher.current.clear()
        editDispatcher.current.clear()
        if (buildRequestId) dispatcher.current.arm(buildRequestId, projectPath)
        if (applyRequestId) editDispatcher.current.arm(applyRequestId, projectPath)
        return window.bridge.codexSend({
          projectPath,
          text,
          model,
          proposeChanges: includeContext && proposeChanges,
          ...(context ? { context } : {}),
          ...(includeContext && includeDebugger ? { debugger: debugObservations.snapshot(current) } : {}),
          ...(buildRequestId ? { buildRequestId } : {}),
          ...(applyRequestId ? { applyRequestId } : {}),
          ...(debugRequestId ? { debugRequestId } : {}),
        })
      }),
  }
}
