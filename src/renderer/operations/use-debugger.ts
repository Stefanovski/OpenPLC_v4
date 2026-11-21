import { isDebugExecution, PlcDebugRequest, PlcDebugResult } from '@root/types/plc-operations/debugger'
import type { PlcOperationTransport } from '@root/types/plc-operations/transport'
import { useEffect, useRef, useState } from 'react'

import { openPLCStoreBase } from '../store'
import { preparePlcProjectData } from './build'
import { buildPlcContext } from './context'
import { debuggerTarget, debugTargetKey, guardDebugAction } from './debug-target'
import { contentKey } from './edits'

type DebugRequest = { action: PlcDebugRequest; target: string; onResult?: () => void }

export function usePlcDebugger(
  projectPath: string,
  transport: Pick<PlcOperationTransport, 'debugExecute' | 'debugClose'>,
  owner = 'default',
) {
  const epoch = useRef(0)
  const lock = useRef(false)
  const session = useRef<string | null>(null)
  const binding = useRef<{ content: string; target: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<DebugRequest | null>(null)
  const [result, setResult] = useState<PlcDebugResult | null>(null)
  const [status, setStatus] = useState('')
  const flag = (value: boolean) =>
    openPLCStoreBase.setState((s) =>
      !value && s.workspace.plcOperationsDebuggerOwner && s.workspace.plcOperationsDebuggerOwner !== owner
        ? s
        : {
            workspace: {
              ...s.workspace,
              plcOperationsDebuggerActive: value,
              plcOperationsDebuggerOwner: value ? owner : undefined,
            },
          },
    )
  const close = () => {
    epoch.current++
    binding.current = null
    session.current = null
    lock.current = false
    setBusy(false)
    setPending(null)
    setResult(null)
    flag(false)
    setStatus('PLC operations debugger connection closed. PLC execution and breakpoints remain unchanged.')
    void transport.debugClose().catch(() => {})
  }
  useEffect(() => {
    setPending(null)
    setResult(null)
    setBusy(false)
    lock.current = false
    const unsubscribe = openPLCStoreBase.subscribe((s) => {
      if (!binding.current) return
      try {
        if (
          s.project.meta.path !== projectPath ||
          s.workspace.isDebuggerVisible ||
          s.workspace.debuggerTargetIp ||
          s.workspace.editingState === 'save-request' ||
          binding.current.target !== debugTargetKey(s) ||
          binding.current.content !== contentKey(buildPlcContext(s))
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
      void transport.debugClose().catch(() => {})
    }
  }, [projectPath, transport, owner])
  const execute = async (request: DebugRequest, confirmed: boolean) => {
    if (lock.current) return
    const run = ++epoch.current
    lock.current = true
    setBusy(true)
    setPending(null)
    setStatus('Checking source identity and debugger target…')
    try {
      const s = openPLCStoreBase.getState()
      if (s.workspace.plcOperationsDebuggerActive && s.workspace.plcOperationsDebuggerOwner !== owner)
        throw new Error('Another provider owns the PLC debugger.')
      guardDebugAction(s, request.action, request.target)
      const data = preparePlcProjectData(s)
      binding.current = { content: contentKey(request.action.base), target: request.target }
      flag(true)
      const response = await transport.debugExecute({
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
      request.onResult?.()
      return response
    } catch (error) {
      if (run !== epoch.current) return
      binding.current = null
      session.current = null
      flag(false)
      void transport.debugClose().catch(() => {})
      setStatus(error instanceof Error ? error.message : 'Debugger command failed.')
      return {
        success: false,
        sessionId: null,
        host: null,
        sampledAt: Date.now(),
        error: error instanceof Error ? error.message : 'Debugger command failed.',
      } satisfies PlcDebugResult
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
    // Internal host-only entry point; MCP model input never supplies approval.
    runApproved: (request: DebugRequest) => execute(request, true),
    request: (request: DebugRequest) => {
      try {
        guardDebugAction(openPLCStoreBase.getState(), request.action, request.target)
        if (isDebugExecution(request.action.command.operation)) {
          if (!session.current)
            throw new Error('Connect the PLC operations debugger before requesting execution commands.')
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
