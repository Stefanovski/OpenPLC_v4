import { CodexDebugAction, CodexDebugResult, isDebugExecution } from '@root/types/IPC/codex-debug-control'
import { useEffect, useRef, useState } from 'react'

import { openPLCStoreBase } from '../store'
import { prepareCodexProjectData } from '../utils/codex-build'
import { buildCodexContext } from '../utils/codex-context'
import { debuggerTarget, debugTargetKey, guardDebugAction } from '../utils/codex-debug-control'
import { contentKey } from '../utils/codex-edits'

export function useCodexDebugger(projectPath: string, afterResult: (model: string) => void) {
  const feedback = useRef(afterResult)
  feedback.current = afterResult
  const epoch = useRef(0)
  const lock = useRef(false)
  const session = useRef<string | null>(null)
  const binding = useRef<{ content: string; target: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ action: CodexDebugAction; target: string } | null>(null)
  const [result, setResult] = useState<CodexDebugResult | null>(null)
  const [status, setStatus] = useState('')
  const flag = (value: boolean) =>
    openPLCStoreBase.setState((s) => ({ workspace: { ...s.workspace, codexDebuggerActive: value } }))
  const close = () => {
    epoch.current++
    binding.current = null
    session.current = null
    lock.current = false
    setBusy(false)
    setPending(null)
    setResult(null)
    flag(false)
    setStatus('Codex debugger connection closed. PLC execution and breakpoints remain unchanged.')
    void window.bridge.codexDebugClose().catch(() => {})
  }
  useEffect(() => {
    const unsubscribe = openPLCStoreBase.subscribe((s) => {
      if (!binding.current) return
      try {
        if (
          s.project.meta.path !== projectPath ||
          s.workspace.isDebuggerVisible ||
          s.workspace.debuggerTargetIp ||
          s.workspace.editingState === 'save-request' ||
          binding.current.target !== debugTargetKey(s) ||
          binding.current.content !== contentKey(buildCodexContext(s))
        )
          close()
      } catch {
        close()
      }
    })
    return () => {
      unsubscribe()
      epoch.current++
      binding.current = null
      session.current = null
      flag(false)
      void window.bridge.codexDebugClose().catch(() => {})
    }
  }, [projectPath])
  const execute = async (request: { action: CodexDebugAction; target: string }, confirmed: boolean) => {
    if (lock.current) return
    const run = ++epoch.current
    lock.current = true
    setBusy(true)
    setPending(null)
    setStatus('Checking source identity and debugger target…')
    try {
      const s = openPLCStoreBase.getState()
      guardDebugAction(s, request.action, request.target)
      const data = prepareCodexProjectData(s)
      binding.current = { content: contentKey(request.action.base), target: request.target }
      flag(true)
      const response = await window.bridge.codexDebugExecute({
        ...data,
        projectPath,
        host: debuggerTarget(s),
        sessionId: session.current,
        command: request.action.command,
        confirmExecution: confirmed,
      })
      if (run !== epoch.current) return
      guardDebugAction(openPLCStoreBase.getState(), request.action, request.target)
      session.current = response.sessionId
      if (!response.sessionId) binding.current = null
      flag(!!response.sessionId)
      setResult(response)
      setStatus(
        response.success
          ? `Debugger: ${response.operation}. ${response.values?.length ?? 0} sampled values. No compilation or download.`
          : response.error ?? 'Debugger failed.',
      )
      feedback.current(request.action.model)
    } catch (error) {
      if (run !== epoch.current) return
      binding.current = null
      session.current = null
      flag(false)
      void window.bridge.codexDebugClose().catch(() => {})
      setStatus(error instanceof Error ? error.message : 'Debugger command failed.')
    } finally {
      if (run === epoch.current) {
        lock.current = false
        setBusy(false)
      }
    }
  }
  return {
    busy,
    pending,
    result,
    status,
    close,
    request: (request: { action: CodexDebugAction; target: string }) => {
      try {
        guardDebugAction(openPLCStoreBase.getState(), request.action, request.target)
        if (isDebugExecution(request.action.command.operation)) {
          if (!session.current) throw new Error('Connect the Codex debugger before requesting execution commands.')
          setPending(request)
          setStatus('Review the target and execution command before confirming.')
        } else void execute(request, false)
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Debugger request refused.')
      }
    },
    confirm: () => {
      if (pending) void execute(pending, true)
    },
    dismiss: () => {
      if (pending) {
        setPending(null)
        setStatus('Debugger command dismissed; nothing executed.')
      }
    },
  }
}
