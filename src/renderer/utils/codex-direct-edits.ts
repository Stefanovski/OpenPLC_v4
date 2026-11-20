import type { CodexMessage, CodexState } from '@root/types/IPC/codex'

import type { RootState } from '../store'
import { CodexUndo, prepareCodexChanges, prepareCodexUndo } from './codex-edits'

/** A completed response is actionable only for a locally initiated, still-pending send. */
export function createCodexEditDispatcher() {
  let pending: { id: string; path: string } | null = null
  return {
    arm: (id: string, path: string) => {
      pending = { id, path }
    },
    clear: () => {
      pending = null
    },
    take: (state: CodexState): CodexMessage | null => {
      if (!pending) return null
      if (state.projectPath !== pending.path || state.connection !== 'connected' || state.error || !state.account) {
        pending = null
        return null
      }
      if (state.busy || state.operationPending) return null
      const message = state.messages.find(
        (m) => m.role === 'assistant' && !m.scratchOnly && m.applyRequestId === pending!.id,
      )
      if (!message) return null
      const path = pending.path
      pending = null
      return message.proposal?.base.projectPath === path && !message.buildAction ? message : null
    },
  }
}

export type CodexEditOutcome = { status: 'applied' | 'undone' | 'blocked'; detail: string }
export function createCodexEditController(getState: () => RootState, setState: (patch: Partial<RootState>) => void) {
  let undo: { id: string; data: CodexUndo } | null = null
  let outcomes: Record<string, CodexEditOutcome> = {}
  return {
    snapshot: () => ({ outcomes, undoId: undo?.id ?? null }),
    apply(message: CodexMessage) {
      if (outcomes[message.id]?.status === 'applied') return true
      try {
        if (!message.proposal || message.scratchOnly) throw new Error('No applicable project changes.')
        const transaction = prepareCodexChanges(getState(), message.proposal)
        setState(transaction.patch)
        undo = { id: message.id, data: transaction.undo }
        const names = message.proposal.reply.changes.map((c) => c.name).join(', ')
        const unscheduled = message.proposal.reply.changes
          .filter(
            (c) =>
              c.operation === 'create' &&
              c.kind === 'program' &&
              !message.proposal!.reply.instances.some((instance) => instance.program === c.name),
          )
          .map((c) => c.name)
        outcomes = {
          ...outcomes,
          [message.id]: {
            status: 'applied',
            detail: `Applied to editor: ${names || 'program instances'}. Unsaved; no PLC download.${unscheduled.length ? ` Not scheduled: ${unscheduled.join(', ')}. Assign to a task before it can run.` : ''}`,
          },
        }
        return true
      } catch (error) {
        outcomes = {
          ...outcomes,
          [message.id]: {
            status: 'blocked',
            detail: error instanceof Error ? error.message : 'Changes could not be applied.',
          },
        }
        return false
      }
    },
    undo() {
      if (!undo) return
      const patch = prepareCodexUndo(getState(), undo.data)
      setState(patch)
      outcomes = {
        ...outcomes,
        [undo.id]: { status: 'undone', detail: 'Codex change undone. Previous editor content restored.' },
      }
      undo = null
    },
  }
}
