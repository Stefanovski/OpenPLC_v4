import { ArrowUpIcon, CodeIcon, Cross2Icon } from '@radix-ui/react-icons'
import { useCodex } from '@root/renderer/hooks/use-codex'
import { useCodexBuild } from '@root/renderer/hooks/use-codex-build'
import { useCodexChanges } from '@root/renderer/hooks/use-codex-changes'
import { useCodexDebugger } from '@root/renderer/hooks/use-codex-debugger'
import { openPLCStoreBase, useOpenPLCStore } from '@root/renderer/store'
import { buildCodexContext } from '@root/renderer/utils/codex-context'
import { debugObservations } from '@root/renderer/utils/codex-debug'
import { describeCodexContext, parseCodexContext } from '@root/types/IPC/codex-context'
import { describeCodexDebug } from '@root/types/IPC/codex-debug'
import { useEffect, useRef, useState } from 'react'

import { Modal, ModalContent, ModalTitle } from '../_molecules/modal'
import { CodexChanges } from './codex-changes'

const CodexSidebar = ({ projectName, projectPath }: { projectName: string; projectPath: string }) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [includeDebugger, setIncludeDebugger] = useState(false)
  const [activeDebugger, setActiveDebugger] = useState(true)
  const [proposeChanges, setProposeChanges] = useState(true)
  const [directEdits, setDirectEdits] = useState(true)
  const [contextPreview, setContextPreview] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const build = useCodexBuild(projectPath)
  const changes = useCodexChanges()
  const debugFeedback = useRef<(model: string) => void>(() => {})
  const debuggerControl = useCodexDebugger(projectPath, (model) => debugFeedback.current(model))
  const dhcpTarget = useOpenPLCStore(
    (s) => s.deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledDHCP,
  )
  const temporaryTargetIp = useOpenPLCStore((s) => s.deviceDefinitions.temporaryDhcpIp ?? '')
  const setTemporaryTargetIp = useOpenPLCStore((s) => s.deviceActions.setTemporaryDhcpIp)
  const {
    state,
    error,
    pending,
    action: codexAction,
    send,
    selectRuntime,
    analyzeDebugResult,
  } = useCodex(
    projectPath,
    (request) => {
      void build.start(request.model, request.base)
    },
    changes.apply,
    debuggerControl.request,
  )
  debugFeedback.current = (model) => {
    void analyzeDebugResult(model)
  }
  const action: typeof codexAction = (value) => {
    debuggerControl.close()
    return codexAction(value)
  }
  const [model, setModel] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const compilationRef = useRef<HTMLElement>(null)
  const debuggerRef = useRef<HTMLElement>(null)
  const followOutput = useRef(true)
  const availableModel = state.models.some((entry) => entry.id === model)
    ? model
    : (state.models.find((entry) => entry.isDefault) ?? state.models[0])?.id ?? ''
  const working =
    pending || state.operationPending || state.connection === 'connecting' || build.busy || debuggerControl.busy
  const canSend =
    !!state.account &&
    !!availableModel &&
    !working &&
    !state.busy &&
    !!draft.trim() &&
    state.projectPath === projectPath
  const buttonClass =
    'rounded-md border border-neutral-300 px-3 py-2 text-xs hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-900'
  const sendDraft = async () => {
    if (!canSend) return
    const text = draft
    followOutput.current = true
    debuggerControl.dismiss()
    if (await send(text, availableModel, includeContext, proposeChanges, includeDebugger, directEdits, activeDebugger))
      setDraft((current) => (current === text ? '' : current))
  }

  useEffect(() => {
    if (build.busy) return
    if (followOutput.current && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [state.messages, open, build.busy])

  useEffect(() => {
    if (build.status) compilationRef.current?.scrollIntoView({ block: 'nearest' })
  }, [build.status])

  useEffect(() => {
    if (debuggerControl.pending) debuggerRef.current?.scrollIntoView({ block: 'nearest' })
  }, [debuggerControl.pending])

  useEffect(() => {
    if (open) closeRef.current?.focus()
    else if (wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <>
      {!open && (
        <button
          ref={triggerRef}
          type='button'
          aria-label='Open Codex'
          aria-expanded={false}
          aria-controls='codex-sidebar'
          title='Open Codex'
          onClick={() => setOpen(true)}
          className='absolute bottom-6 right-6 z-20 flex h-12 items-center gap-2 rounded-full border border-brand-light bg-brand px-5 font-caption text-sm font-medium text-white shadow-oplc hover:bg-brand-medium focus-visible:ring-2 focus-visible:ring-brand-light focus-visible:ring-offset-2'
        >
          <CodeIcon aria-hidden='true' className='h-5 w-5' />
          Codex
          {state.busy && <span className='h-2 w-2 rounded-full bg-white' aria-label='Codex is responding' />}
        </button>
      )}
      <aside
        id='codex-sidebar'
        aria-label='Codex assistant'
        hidden={!open}
        onKeyDown={(event) => {
          // Portalled change reviews own Escape; closing them must not close the sidebar.
          if (event.target instanceof Element && event.target.closest('[data-codex-context-preview]')) return
          // Escape applies only inside this panel, never to the PLC editor or its dialogs.
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.stopPropagation()
            event.preventDefault()
            setOpen(false)
          }
        }}
        className={
          open
            ? 'm-2 ml-0 flex h-[calc(100%-1rem)] w-80 max-w-[45%] shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-300 bg-white font-caption text-neutral-950 xl:w-96 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
            : 'hidden'
        }
      >
        <header className='flex shrink-0 items-center justify-between gap-3 border-b border-neutral-300 p-4 dark:border-neutral-800'>
          <div className='flex items-center gap-2'>
            <CodeIcon aria-hidden='true' className='h-5 w-5 text-brand dark:text-brand-light' />
            <h2 className='text-sm font-semibold'>Codex</h2>
            <span className='rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-800 dark:bg-neutral-900 dark:text-neutral-400'>
              Chat
            </span>
          </div>
          <button
            ref={closeRef}
            type='button'
            aria-label='Close Codex'
            title='Close Codex (Escape)'
            onClick={() => setOpen(false)}
            className='rounded p-2 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-neutral-900'
          >
            <Cross2Icon aria-hidden='true' className='h-4 w-4' />
          </button>
        </header>
        <div
          ref={messagesRef}
          onScroll={() => {
            const element = messagesRef.current
            if (element) followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}
          className='min-h-0 flex-1 overflow-y-auto p-4'
        >
          <p className='mb-3 break-words text-xs text-neutral-800 dark:text-neutral-400'>Project: {projectName}</p>
          <p role='status' className='mb-3 break-words text-xs'>
            {state.connection === 'connecting'
              ? 'Connecting to Codex…'
              : state.account
                ? `Signed in${state.account.email ? ` as ${state.account.email}` : ''}${state.account.plan ? ` · ${state.account.plan}` : ''}`
                : state.loginPending
                  ? 'Waiting for browser sign-in…'
                  : state.connection === 'connected'
                    ? 'Ready to sign in'
                    : 'Not connected'}
          </p>
          <div className='mb-3 flex flex-wrap gap-2'>
            {state.connection !== 'connected' ? (
              <>
                <button type='button' disabled={working} onClick={() => void action('connect')} className={buttonClass}>
                  Connect Codex
                </button>
                <button type='button' disabled={working} onClick={() => void selectRuntime()} className={buttonClass}>
                  Select runtime…
                </button>
              </>
            ) : state.loginPending ? (
              <>
                <button type='button' onClick={() => void action('reopen-login')} className={buttonClass}>
                  Open sign-in page
                </button>
                <button type='button' onClick={() => void action('cancel-login')} className={buttonClass}>
                  Cancel sign-in
                </button>
              </>
            ) : !state.account ? (
              <button type='button' disabled={working} onClick={() => void action('sign-in')} className={buttonClass}>
                Sign in with Codex
              </button>
            ) : (
              <button
                type='button'
                disabled={working || state.busy}
                onClick={() => void action('sign-out')}
                className={buttonClass}
              >
                Sign out
              </button>
            )}
            {state.connection === 'connected' && (
              <button
                type='button'
                disabled={build.busy}
                onClick={() => void action('disconnect')}
                className={buttonClass}
              >
                Disconnect
              </button>
            )}
            {state.messages.length > 0 && (
              <button
                type='button'
                disabled={working || state.busy}
                onClick={() => void action('new-chat')}
                className={buttonClass}
              >
                New chat
              </button>
            )}
          </div>
          {!state.account && (
            <p className='mb-4 text-xs leading-relaxed text-neutral-800 dark:text-neutral-400'>
              Use your own account with Codex access. Sign-in opens in your browser and is stored separately from Codex
              Desktop.
            </p>
          )}
          <p className='mb-4 text-xs text-neutral-800 dark:text-neutral-400'>
            Project context, code editing and compilation · No PLC download.
          </p>
          <div className='mb-4 space-y-2 text-xs'>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={includeContext}
                disabled={working || state.busy}
                onChange={(event) => {
                  setIncludeContext(event.target.checked)
                  if (!event.target.checked) setIncludeDebugger(false)
                  if (!event.target.checked) debuggerControl.close()
                }}
                className='accent-brand'
              />
              Include current project and IO context
            </label>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={activeDebugger && includeContext}
                disabled={!includeContext || working || state.busy}
                onChange={(event) => {
                  setActiveDebugger(event.target.checked)
                  if (!event.target.checked) debuggerControl.close()
                }}
                className='accent-brand'
              />
              Enable active debugger commands
            </label>
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={includeContext && includeDebugger}
                disabled={!includeContext || working || state.busy}
                onChange={(event) => setIncludeDebugger(event.target.checked)}
                className='accent-brand'
              />
              Include debugger observations (read-only)
            </label>
            {includeContext && includeDebugger && (
              <p className='text-neutral-800 dark:text-neutral-400'>
                Shares sampled watch values, IEC status and call stack when available. Connect and watch variables in
                the debugger first. No extra PLC requests. Samples older than 5 seconds are stale; source matching is
                unverified.
              </p>
            )}
            <label className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={proposeChanges && includeContext}
                disabled={!includeContext || working || state.busy}
                onChange={(event) => setProposeChanges(event.target.checked)}
                className='accent-brand'
              />
              Enable ST / C++ editing
            </label>
            <label className='block'>
              Code changes
              <select
                aria-label='Code changes'
                value={directEdits ? 'direct' : 'review'}
                disabled={!includeContext || !proposeChanges || working || state.busy}
                onChange={(event) => setDirectEdits(event.target.value === 'direct')}
                className='mt-1 block w-full rounded border bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900'
              >
                <option value='direct'>Apply requested changes directly</option>
                <option value='review'>Review changes first</option>
              </select>
            </label>
            <p className='text-neutral-800 dark:text-neutral-400'>
              {includeContext && proposeChanges && directEdits
                ? 'Requested edits are applied to unsaved editor buffers after validation. Undo remains available until another edit or save. No automatic save or PLC download.'
                : 'Changes require review and Apply. Project context and editing must be enabled to create or change code.'}
            </p>
            <button
              type='button'
              className={buttonClass}
              onClick={() => {
                try {
                  setContextPreview(
                    JSON.stringify(
                      {
                        ...describeCodexContext(
                          parseCodexContext(buildCodexContext(openPLCStoreBase.getState()).snapshot),
                        ),
                        ...(includeContext && includeDebugger
                          ? { debugger: describeCodexDebug(debugObservations.snapshot(openPLCStoreBase.getState())) }
                          : {}),
                      },
                      null,
                      2,
                    ),
                  )
                } catch (error) {
                  setContextPreview(error instanceof Error ? error.message : 'Could not build project context.')
                }
              }}
            >
              Preview project context
            </button>
            <p className='text-neutral-800 dark:text-neutral-400'>
              Includes unsaved code. Refreshed on send; no automatic hardware scan. Earlier snapshots remain in this
              chat.
            </p>
          </div>
          <CodexChanges
            controller={changes}
            messages={state.projectPath === projectPath ? [...state.messages, ...build.messages] : []}
            busy={working || state.busy}
          />
          <section ref={debuggerRef} aria-label='Codex active debugger' className='mb-4 space-y-2 text-xs'>
            {dhcpTarget && (
              <label className='block space-y-1'>
                <span>PLC target IP (DHCP)</span>
                <input
                  aria-label='PLC target IP (DHCP)'
                  value={temporaryTargetIp}
                  disabled={debuggerControl.busy}
                  onChange={(event) => setTemporaryTargetIp(event.target.value.trim())}
                  placeholder='192.168.1.100'
                  className='w-full rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-800'
                />
                <span className='block text-neutral-800 dark:text-neutral-400'>
                  Session target only; does not change the PLC network configuration.
                </span>
              </label>
            )}
            <p>
              Active debugging uses existing matching debug artifacts over Modbus TCP. No automatic compilation or PLC
              download. Execution commands require confirmation.
            </p>
            {debuggerControl.status && <p role='status'>{debuggerControl.status}</p>}
            {debuggerControl.pending && (
              <div className='space-y-2 rounded border border-amber-500 p-2'>
                <p>
                  Requested command: {debuggerControl.pending.action.command.operation} · Statement ID:{' '}
                  {debuggerControl.pending.action.command.statementId}
                </p>
                {debuggerControl.result?.catalog?.statements
                  .filter((s) => s.id === debuggerControl.pending?.action.command.statementId)
                  .map((s) => (
                    <p key={s.id}>
                      POU: {s.pou} · Source line: {s.line}
                    </p>
                  ))}
                <p>
                  Target: {debuggerControl.result?.host ?? 'No active session'}. This may halt or advance PLC execution.
                </p>
                <button
                  type='button'
                  className={buttonClass}
                  disabled={working || state.busy}
                  onClick={debuggerControl.confirm}
                >
                  Execute debugger command
                </button>
                <button type='button' className={buttonClass} onClick={debuggerControl.dismiss}>
                  Dismiss debugger command
                </button>
              </div>
            )}
            {(debuggerControl.busy || debuggerControl.result?.sessionId) && (
              <button type='button' className={buttonClass} onClick={debuggerControl.close}>
                Close Codex debugger connection
              </button>
            )}
            <p>Closing the connection leaves PLC execution and existing breakpoints unchanged.</p>
            {debuggerControl.result && (
              <details>
                <summary>Debugger observations and statement catalog</summary>
                <pre className='max-h-64 select-text overflow-auto whitespace-pre-wrap break-all'>
                  {JSON.stringify(debuggerControl.result, null, 2)}
                </pre>
              </details>
            )}
          </section>
          <section ref={compilationRef} aria-label='Codex compilation' className='mb-4 space-y-2 text-xs'>
            <button
              type='button'
              className={buttonClass}
              disabled={
                working ||
                state.busy ||
                !state.account ||
                !availableModel ||
                !includeContext ||
                !proposeChanges ||
                state.projectPath !== projectPath
              }
              onClick={() => void build.start(availableModel)}
            >
              Compile and fix errors
            </button>
            {build.busy && (
              <button type='button' className={buttonClass} onClick={build.stop}>
                Stop compilation workflow
              </button>
            )}
            <p className='text-neutral-800 dark:text-neutral-400'>
              Checks current buffers in a temporary copy. Up to 3 Codex correction rounds; review before applying. No
              save or download. You can also ask Codex in chat to compile and fix errors.
            </p>
            {build.status && <p role='status'>{build.status}</p>}
            {build.diagnostics && (
              <details>
                <summary className='cursor-pointer'>Compiler diagnostics</summary>
                <pre className='mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap break-all text-xs'>
                  {build.diagnostics}
                </pre>
              </details>
            )}
          </section>
          {error && (
            <p
              role='alert'
              className='mb-4 select-text break-words rounded border border-red-400 p-3 text-xs text-red-700 dark:text-red-300'
            >
              {error}
            </p>
          )}
          <div aria-label='Codex conversation' className='space-y-4'>
            {state.projectPath === projectPath &&
              state.messages
                .filter((message) => !message.scratchOnly)
                .map((message) => (
                  <article
                    key={message.id}
                    className='rounded-lg border border-neutral-300 p-3 dark:border-neutral-800'
                  >
                    <p className='mb-2 text-xs font-semibold text-brand dark:text-brand-light'>
                      {message.role === 'user' ? 'You' : 'Codex'}
                    </p>
                    {message.context && (
                      <p className='mb-2 text-xs text-neutral-800 dark:text-neutral-400'>
                        Project snapshot: {message.context.pous} POUs · IO: {message.context.ioStatus} ·{' '}
                        {new Date(message.context.capturedAt).toLocaleTimeString()}
                      </p>
                    )}
                    {message.debugger && (
                      <p className='text-xs text-neutral-800 dark:text-neutral-400'>
                        Debugger snapshot: {message.debugger.variables} values · Status:{' '}
                        {message.debugger.statusFreshness} ·{' '}
                        {new Date(message.debugger.capturedAt).toLocaleTimeString()}
                      </p>
                    )}
                    <div className='select-text whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]'>
                      {message.text}
                    </div>
                    {message.proposal && (
                      <div className='mt-3 space-y-2 border-t border-neutral-300 pt-2 text-xs dark:border-neutral-700'>
                        {changes.outcomes[message.id] ? (
                          <p role='status'>{changes.outcomes[message.id].detail}</p>
                        ) : (
                          <p>
                            Changes ready:{' '}
                            {message.proposal.reply.changes.map((change) => change.name).join(', ') ||
                              'program instances'}
                            .
                          </p>
                        )}
                        {changes.outcomes[message.id]?.status !== 'applied' && (
                          <button
                            type='button'
                            className={buttonClass}
                            disabled={working || state.busy}
                            onClick={() => {
                              changes.setError('')
                              changes.setSelected(message)
                            }}
                          >
                            Review this change
                          </button>
                        )}
                        {changes.undoId === message.id && (
                          <button
                            type='button'
                            className={buttonClass}
                            disabled={working || state.busy}
                            onClick={changes.undoLast}
                          >
                            Undo this change
                          </button>
                        )}
                        {changes.undoId === message.id && changes.undoError && (
                          <p role='alert' className='text-red-700 dark:text-red-300'>
                            {changes.undoError}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
          </div>
          {state.busy && (
            <p role='status' className='mt-4 text-xs'>
              Codex is responding…
            </p>
          )}
        </div>
        <div className='shrink-0 border-t border-neutral-300 p-4 dark:border-neutral-800'>
          {state.account && (
            <label className='mb-3 block text-xs'>
              Model
              <select
                aria-label='Codex model'
                value={availableModel}
                disabled={working || state.busy}
                onChange={(event) => setModel(event.target.value)}
                className='mt-1 block w-full rounded border-neutral-300 bg-white text-xs dark:border-neutral-800 dark:bg-neutral-900'
              >
                {!state.models.length && <option value=''>No models available</option>}
                {state.models.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label htmlFor='codex-draft' className='mb-2 block text-xs font-medium'>
            Message draft
          </label>
          <textarea
            id='codex-draft'
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby='codex-draft-note'
            placeholder='Describe what you want to program…'
            rows={3}
            maxLength={32000}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void sendDraft()
              }
            }}
            className='block w-full resize-none rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm placeholder:text-neutral-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand dark:border-neutral-800 dark:bg-neutral-900 dark:placeholder:text-neutral-500'
          />
          <div className='mt-2 flex items-center justify-between gap-3'>
            <p id='codex-draft-note' className='text-xs text-neutral-800 dark:text-neutral-400'>
              {includeContext
                ? 'Message and project snapshot are sent to Codex.'
                : 'Only this message is attached; earlier context remains in the chat.'}{' '}
              Ctrl+Enter to send.
            </p>
            <button
              type='button'
              disabled={!state.busy && !canSend}
              aria-label={state.busy ? 'Stop response' : 'Send message'}
              title={state.busy ? 'Stop response' : 'Send message (Ctrl+Enter)'}
              onClick={() => {
                if (build.busy) build.stop()
                else if (state.busy) void action('stop')
                else void sendDraft()
              }}
              className='shrink-0 rounded-md bg-brand p-2 text-white disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-700 dark:disabled:bg-neutral-900 dark:disabled:text-neutral-500'
            >
              {state.busy ? (
                <span aria-hidden='true' className='block h-5 w-5 p-1'>
                  ■
                </span>
              ) : (
                <ArrowUpIcon aria-hidden='true' className='h-5 w-5' />
              )}
            </button>
          </div>
        </div>
      </aside>
      <Modal
        open={contextPreview !== null}
        onOpenChange={(value) => {
          if (!value) setContextPreview(null)
        }}
      >
        <ModalContent data-codex-context-preview className='h-[80vh] w-[85vw] max-w-4xl'>
          <ModalTitle>Project context preview</ModalTitle>
          <p className='text-xs text-neutral-800 dark:text-neutral-400'>
            This is a preview. Sending creates a new snapshot of the current editor state. IO freshness is checked again
            before transmission.
          </p>
          <textarea
            aria-label='Project context preview'
            readOnly
            value={contextPreview ?? ''}
            className='min-h-0 flex-1 resize-none rounded border border-neutral-300 bg-white p-3 font-mono text-xs text-neutral-950 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100'
          />
          <button type='button' className={buttonClass} onClick={() => setContextPreview(null)}>
            Close preview
          </button>
        </ModalContent>
      </Modal>
    </>
  )
}

// A project switch clears local drafts; opening/closing the sidebar does not.
const WorkspaceCodexSidebar = () => {
  const projectPath = useOpenPLCStore((state) => state.project.meta.path)
  const projectName = useOpenPLCStore((state) => state.project.meta.name)
  return <CodexSidebar key={projectPath} projectName={projectName} projectPath={projectPath} />
}

export { WorkspaceCodexSidebar }
