import type { PlcProposal } from '@root/types/plc-operations/edits'

import type { RootState } from '../store'
import { PlcUndo, preparePlcChanges, preparePlcUndo } from './edits'
export type PlcEditRequest = { id: string; proposal?: PlcProposal; scratchOnly?: boolean }

export type PlcEditOutcome = { status: 'applied' | 'undone' | 'blocked'; detail: string }
export function createPlcEditController(getState: () => RootState, setState: (patch: Partial<RootState>) => void) {
  let undo: { id: string; data: PlcUndo } | null = null
  let outcomes: Record<string, PlcEditOutcome> = {}
  return {
    snapshot: () => ({ outcomes, undoId: undo?.id ?? null }),
    apply(message: PlcEditRequest) {
      if (outcomes[message.id]?.status === 'applied') return true
      try {
        if (!message.proposal || message.scratchOnly) throw new Error('No applicable project changes.')
        const transaction = preparePlcChanges(getState(), message.proposal)
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
      const patch = preparePlcUndo(getState(), undo.data)
      setState(patch)
      outcomes = {
        ...outcomes,
        [undo.id]: { status: 'undone', detail: 'Project change undone. Previous editor content restored.' },
      }
      undo = null
    },
  }
}
