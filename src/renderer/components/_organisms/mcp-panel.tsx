import { emptyMcpState, McpState } from '@root/types/IPC/mcp'
import { PLCVariableSchema } from '@root/types/PLC/open-plc'
import { parsePlcContext, PlcContext } from '@root/types/plc-operations/context'
import type { PlcOperationTransport } from '@root/types/plc-operations/transport'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'
import { useEffect, useRef, useState } from 'react'

import { buildPlcContext } from '../../operations/context'
import { debugObservations } from '../../operations/debug-observations'
import { debuggerTarget, debugTargetKey } from '../../operations/debug-target'
import { usePlcDebugger } from '../../operations/use-debugger'
import { openPLCStoreBase, useOpenPLCStore } from '../../store'
import { createMcpEditorOperations, guardMcpRequest } from '../../utils/mcp-operations'
import { Modal, ModalContent, ModalTitle } from '../_molecules/modal'

const button =
  'rounded border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
function previousCode(pou: PlcContext['project']['pous'][number] | undefined) {
  if (!pou) return '(new POU)'
  const variables = PLCVariableSchema.array().safeParse(pou.declarations.variables)
  const declarations = pou.declarations.text ?? (variables.success ? generateIecVariablesToString(variables.data) : '')
  return `Documentation: ${pou.documentation}\n${pou.returnType ? `Return type: ${pou.returnType}\n` : ''}${declarations}\n\n${typeof pou.body === 'string' ? pou.body : '(graphical body)'}`
}
function McpPanel({ projectPath }: { projectPath: string }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<McpState>(emptyMcpState)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [undoId, setUndoId] = useState<string | null>(null)
  const live = useRef(state)
  const activeId = useRef('')
  const transport = useRef<Pick<PlcOperationTransport, 'debugExecute' | 'debugClose'>>({
    debugExecute: (data) => window.bridge.mcpDebug(activeId.current, data),
    debugClose: () => window.bridge.mcpDebugClose(),
  })
  const debuggerControl = usePlcDebugger(projectPath, transport.current, 'mcp')
  const debug = useRef(debuggerControl)
  debug.current = debuggerControl
  const operations = useRef<ReturnType<typeof createMcpEditorOperations> | null>(null)
  if (!operations.current)
    operations.current = createMcpEditorOperations(
      openPLCStoreBase.getState,
      openPLCStoreBase.setState,
      (id, data) => window.bridge.mcpCompile(id, data),
      (id, request) => {
        activeId.current = id
        return debug.current.runApproved(request)
      },
    )
  const dhcp = useOpenPLCStore(
    (s) => s.deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledDHCP,
  )
  const targetIp = useOpenPLCStore((s) => s.deviceDefinitions.temporaryDhcpIp ?? '')
  const setTarget = useOpenPLCStore((s) => s.deviceActions.setTemporaryDhcpIp)
  useEffect(() => {
    let alive = true
    const receive = (next: McpState) => {
      if (!alive) return
      if (
        !next.enabled ||
        (live.current.pending &&
          !next.pending &&
          next.results.some((r) => r.id === live.current.pending?.id && r.status === 'cancelled'))
      )
        debug.current.close()
      live.current = next
      setState(next)
    }
    const unsubscribe = window.bridge.onMcpState(receive)
    const unlisten = window.bridge.onMcpCapture((id) => {
      const s = openPLCStoreBase.getState()
      let capture = null
      try {
        if (s.project.meta.path === projectPath)
          capture = {
            projectPath,
            target: debugTargetKey(s),
            context: buildPlcContext(s),
            debugger: debugObservations.snapshot(s),
          }
      } catch {
        /* Reject incomplete project snapshots. */
      }
      void window.bridge.mcpCaptureResult(id, capture).catch(() => {})
    })
    void window.bridge
      .mcpState()
      .then(receive)
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
      unsubscribe()
      unlisten()
      live.current = emptyMcpState
      void window.bridge.mcpStop().catch(() => {})
    }
  }, [projectPath])
  const perform = async (action: () => unknown) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MCP operation failed.')
    } finally {
      setBusy(false)
      setUndoId(operations.current!.undoId())
    }
  }
  const approve = () =>
    perform(async () => {
      if (!state.pending) return
      guardMcpRequest(openPLCStoreBase.getState(), state.pending)
      const request = await window.bridge.mcpClaim(state.pending.id)
      try {
        const result = await operations.current!.execute(
          request,
          () => live.current.enabled && live.current.pending?.id === request.id,
        )
        const success = !('success' in result) || result.success !== false
        await window.bridge.mcpComplete(request.id, success, result)
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'MCP operation failed.'
        await window.bridge.mcpComplete(request.id, false, { error: detail })
        throw e
      }
    })
  const pending = state.pending
  const result = state.results.find((r) => r.id === pending?.id)
  const before = pending ? parsePlcContext(pending.capture.context.snapshot) : null
  let target = 'No valid PLC target configured'
  try {
    target = debuggerTarget(openPLCStoreBase.getState())
  } catch {
    /* Shown in the approval. */
  }
  return (
    <>
      <button
        type='button'
        aria-label='Open MCP connections'
        title={pending ? 'MCP · Review request' : state.enabled ? 'MCP · Enabled' : 'External AI connections · MCP'}
        onClick={() => setOpen(true)}
        className='relative flex h-8 w-10 items-center justify-center rounded text-[10px] font-semibold text-brand-light hover:bg-brand-medium focus-visible:ring-2 focus-visible:ring-brand-light'
      >
        MCP
        {(pending || state.enabled) && (
          <span
            aria-label={pending ? 'MCP request awaiting review' : 'MCP enabled'}
            className={`absolute right-0 top-0 h-2 w-2 rounded-full ${pending ? 'bg-amber-400' : 'bg-green-400'}`}
          />
        )}
      </button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          data-plc-mcp
          className='h-[85vh] max-h-[900px] w-[min(900px,94vw)] text-neutral-950 dark:text-neutral-100'
        >
          <ModalTitle>External AI connections · MCP</ModalTitle>
          <div className='min-h-0 flex-1 space-y-4 overflow-auto text-sm'>
            <p>
              Connect a local MCP client to this open project, including unsaved code and IO assignments. Each change,
              compilation and active debugger command requires approval here.
            </p>
            <div className='flex flex-wrap gap-2'>
              {!state.enabled ? (
                <button
                  className={button}
                  disabled={busy || !projectPath}
                  onClick={() => void perform(() => window.bridge.mcpEnable(projectPath))}
                >
                  Enable MCP for this project
                </button>
              ) : (
                <>
                  <button className={button} onClick={() => void perform(() => window.bridge.mcpStop())}>
                    Stop MCP
                  </button>
                  <button className={button} onClick={() => setShowConfig(!showConfig)}>
                    {showConfig ? 'Hide connection settings' : 'Show connection settings'}
                  </button>
                </>
              )}
              {undoId && (
                <button
                  className={button}
                  disabled={busy || !!pending}
                  onClick={() =>
                    void perform(() => {
                      operations.current!.undo()
                    })
                  }
                >
                  Undo last MCP change
                </button>
              )}
              {debuggerControl.result?.sessionId && (
                <button className={button} onClick={() => debuggerControl.close()}>
                  Close MCP debugger connection
                </button>
              )}
            </div>
            {state.enabled && (
              <p>MCP enabled for this editor session. Stopping MCP or changing projects revokes the connection.</p>
            )}
            {state.enabled && showConfig && (
              <section className='space-y-2'>
                <p>
                  Streamable HTTP · localhost only. The token grants access to this project's context. Keep these
                  settings private; they change each time MCP is enabled.
                </p>
                <label className='block'>
                  MCP endpoint
                  <input
                    aria-label='MCP endpoint'
                    readOnly
                    value={state.endpoint ?? ''}
                    className='w-full rounded border bg-transparent p-2 font-mono text-xs'
                  />
                </label>
                <label className='block'>
                  Authorization header
                  <input
                    aria-label='MCP authorization'
                    readOnly
                    type='password'
                    value={`Bearer ${state.token ?? ''}`}
                    className='w-full rounded border bg-transparent p-2 font-mono text-xs'
                  />
                </label>
                <button
                  className={button}
                  onClick={() => void perform(() => navigator.clipboard.writeText(`Bearer ${state.token}`))}
                >
                  Copy authorization header
                </button>
              </section>
            )}
            {dhcp && (
              <label className='block'>
                MCP PLC target IP (DHCP)
                <input
                  aria-label='MCP PLC target IP (DHCP)'
                  value={targetIp}
                  onChange={(e) => setTarget(e.target.value)}
                  className='ml-2 rounded border bg-transparent p-2 text-xs'
                />
              </label>
            )}
            {pending && (
              <section
                aria-label='MCP request review'
                className='space-y-3 rounded border border-neutral-300 p-3 dark:border-neutral-700'
              >
                <h3 className='font-semibold'>
                  Review: {pending.action.operation} · {before?.project.name}
                </h3>
                <p>
                  Request {pending.id} · {result?.status}
                </p>
                {pending.action.operation === 'changes' && (
                  <>
                    <p>Apply to unsaved editor buffers. No save or PLC download.</p>
                    {pending.action.reply.changes.map((change) => (
                      <section key={change.name}>
                        <h4>
                          {change.operation} · {change.name} · {change.kind} · {change.language.toUpperCase()}
                        </h4>
                        <div className='grid grid-cols-2 gap-2'>
                          <label>
                            Before
                            <textarea
                              readOnly
                              aria-label={`MCP before ${change.name}`}
                              value={previousCode(before?.project.pous.find((p) => p.name === change.name))}
                              className='h-52 w-full rounded border bg-transparent p-2 font-mono text-xs'
                            />
                          </label>
                          <label>
                            After
                            <textarea
                              readOnly
                              aria-label={`MCP after ${change.name}`}
                              value={`Documentation: ${change.documentation}\n${change.returnType ? `Return type: ${change.returnType}\n` : ''}${change.declarations}\n\n${change.body}`}
                              className='h-52 w-full rounded border bg-transparent p-2 font-mono text-xs'
                            />
                          </label>
                        </div>
                      </section>
                    ))}
                    {!!pending.action.reply.instances.length && (
                      <section>
                        <h4 className='font-semibold'>New program instances</h4>
                        {pending.action.reply.instances.map((instance) => (
                          <p key={instance.name}>
                            {instance.name}: {instance.program} → {instance.task}
                          </p>
                        ))}
                      </section>
                    )}
                  </>
                )}
                {pending.action.operation === 'compile' && (
                  <p>
                    Compile this snapshot in a temporary directory. The editor and PLC are not modified. Compiler
                    corrections require a separate reviewed change.
                  </p>
                )}
                {pending.action.operation === 'undo' && (
                  <p>Undo the latest MCP change only if no later edits or saves would be lost.</p>
                )}
                {pending.action.operation === 'debug' && (
                  <>
                    <p>
                      PLC target: {target}. Execution or breakpoint changes affect the PLC. Disconnect leaves execution
                      and breakpoints unchanged.
                    </p>
                    <pre className='whitespace-pre-wrap text-xs'>{JSON.stringify(pending.action.command, null, 2)}</pre>
                  </>
                )}
                <div className='flex gap-2'>
                  <button
                    className={button}
                    disabled={busy || result?.status !== 'review-required'}
                    onClick={() => void approve()}
                  >
                    Approve MCP request
                  </button>
                  <button className={button} onClick={() => void perform(() => window.bridge.mcpCancel(pending.id))}>
                    {result?.status === 'executing' ? 'Cancel request' : 'Reject MCP request'}
                  </button>
                </div>
              </section>
            )}
            {state.results
              .slice()
              .reverse()
              .map((entry) => (
                <details key={entry.id} className='rounded border border-neutral-300 p-2 dark:border-neutral-700'>
                  <summary>
                    {entry.operation} · {entry.status}
                  </summary>
                  <p>{entry.detail}</p>
                  {entry.value !== undefined && (
                    <pre className='max-h-64 overflow-auto whitespace-pre-wrap text-xs'>
                      {JSON.stringify(entry.value, null, 2)}
                    </pre>
                  )}
                </details>
              ))}
            {debuggerControl.status && <p role='status'>{debuggerControl.status}</p>}
            {error && (
              <p role='alert' className='text-red-600 dark:text-red-300'>
                {error}
              </p>
            )}
          </div>
          <button className={button} onClick={() => setOpen(false)}>
            Close MCP panel
          </button>
        </ModalContent>
      </Modal>
    </>
  )
}
export function WorkspaceMcpPanel() {
  const path = useOpenPLCStore((s) => s.project.meta.path)
  return <McpPanel key={path} projectPath={path} />
}
