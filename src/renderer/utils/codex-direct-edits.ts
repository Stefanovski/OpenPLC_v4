import type { CodexMessage, CodexState } from '@root/types/IPC/codex'

import { createPlcEditController } from '../operations/edit-controller'
import type { RootState } from '../store'

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

/** Compatibility exports; implementation belongs to the provider-independent PLC operations. */
export { type PlcEditOutcome as CodexEditOutcome } from '../operations/edit-controller'

export function createCodexEditController(getState: () => RootState, setState: (patch: Partial<RootState>) => void) {
  const controller = createPlcEditController(getState, setState)
  return {
    ...controller,
    apply: (message: CodexMessage) =>
      controller.apply({ id: message.id, proposal: message.proposal, scratchOnly: message.scratchOnly }),
  }
}
