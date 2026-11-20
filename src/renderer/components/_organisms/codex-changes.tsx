import type { useCodexChanges } from '@root/renderer/hooks/use-codex-changes'
import type { CodexMessage } from '@root/types/IPC/codex'
import { parseCodexContext } from '@root/types/IPC/codex-context'
import { PLCVariableSchema } from '@root/types/PLC/open-plc'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'

import { Modal, ModalContent, ModalTitle } from '../_molecules/modal'

const button = 'rounded border border-neutral-300 px-3 py-2 text-xs disabled:opacity-50 dark:border-neutral-700'
export function CodexChanges({
  messages,
  busy,
  controller,
}: {
  messages: CodexMessage[]
  busy: boolean
  controller: ReturnType<typeof useCodexChanges>
}) {
  const { selected, setSelected, outcomes, undoId, error, setError, apply, undoLast } = controller
  const applied = Object.keys(outcomes).filter((id) => outcomes[id].status === 'applied')
  const proposal = selected?.proposal
  const base = proposal ? parseCodexContext(proposal.base.snapshot) : null
  return (
    <section aria-label='Codex project changes' className='my-3 space-y-2 text-xs'>
      {messages
        .filter((m) => m.proposal && !m.scratchOnly)
        .map((message) => (
          <div key={message.id}>
            <button
              type='button'
              className={button}
              disabled={busy || applied.includes(message.id)}
              onClick={() => {
                setError('')
                setSelected(message)
              }}
            >
              {applied.includes(message.id)
                ? 'Changes applied'
                : `Review changes (${message.proposal!.reply.changes.length} POUs)`}
            </button>
          </div>
        ))}
      {undoId && (
        <button type='button' className={button} disabled={busy} onClick={undoLast}>
          Undo last Codex change
        </button>
      )}
      {error && !selected && (
        <p role='alert' className='text-red-600 dark:text-red-300'>
          {error}
        </p>
      )}
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            setError('')
          }
        }}
      >
        <ModalContent
          data-codex-context-preview
          className='h-[85vh] w-[92vw] max-w-6xl text-neutral-950 dark:text-neutral-100'
        >
          <ModalTitle>Review Codex project changes</ModalTitle>
          <p className='text-xs'>
            Applies to editor buffers as one unsaved change. Review declarations, code and scheduling. No compilation or
            PLC download is performed. Use Save after testing. Undo is available until another edit or save.
          </p>
          <div className='min-h-0 flex-1 space-y-4 overflow-auto'>
            {proposal?.reply.changes.map((change) => {
              const old = base?.project.pous.find((p) => p.name === change.name)
              const table = PLCVariableSchema.array().safeParse(old?.declarations.variables)
              const oldDeclarations =
                old?.declarations.text ?? (table.success ? generateIecVariablesToString(table.data) : '')
              const previous = old
                ? `Documentation: ${old.documentation}\n${old.returnType ? `Return type: ${old.returnType}\n` : ''}${oldDeclarations}\n\n${String(old.body)}`
                : '(new POU)'
              return (
                <section key={change.name} className='space-y-2'>
                  <h3 className='text-sm font-semibold'>
                    {change.operation} · {change.name} · {change.kind} · {change.language.toUpperCase()}
                  </h3>
                  <div className='grid grid-cols-2 gap-3'>
                    <label className='text-xs'>
                      Before
                      <textarea
                        aria-label={`Before ${change.name}`}
                        readOnly
                        value={previous}
                        className='mt-1 h-64 w-full resize-y rounded border bg-transparent p-2 font-mono text-xs'
                      />
                    </label>
                    <label className='text-xs'>
                      After
                      <textarea
                        aria-label={`After ${change.name}`}
                        readOnly
                        value={`Documentation: ${change.documentation}\n${change.returnType ? `Return type: ${change.returnType}\n` : ''}${change.declarations}\n\n${change.body}`}
                        className='mt-1 h-64 w-full resize-y rounded border bg-transparent p-2 font-mono text-xs'
                      />
                    </label>
                  </div>
                  {change.operation === 'create' &&
                    change.kind === 'program' &&
                    !proposal.reply.instances.some((i) => i.program === change.name) && (
                      <p className='text-xs'>Not scheduled: assign this program to a task before it can run.</p>
                    )}
                </section>
              )
            })}
            {!!proposal?.reply.instances.length && (
              <section>
                <h3 className='font-semibold'>New program instances</h3>
                {proposal.reply.instances.map((i) => (
                  <p key={i.name}>
                    {i.name}: {i.program} → {i.task}
                  </p>
                ))}
              </section>
            )}
          </div>
          {error && (
            <p role='alert' className='text-xs text-red-600 dark:text-red-300'>
              {error}
            </p>
          )}
          <div className='flex justify-end gap-3'>
            <button
              type='button'
              className={button}
              onClick={() => {
                setSelected(null)
                setError('')
              }}
            >
              Cancel changes
            </button>
            <button
              type='button'
              className={button}
              disabled={busy || !proposal || !selected}
              onClick={() => {
                if (!proposal || !selected || applied.includes(selected.id)) return
                if (apply(selected)) setSelected(null)
              }}
            >
              Apply changes
            </button>
          </div>
        </ModalContent>
      </Modal>
    </section>
  )
}
