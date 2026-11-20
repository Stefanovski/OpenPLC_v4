import type { CodexState } from '@root/types/IPC/codex'
/** Compatibility exports; implementation belongs to the provider-independent PLC operations. */
export { debuggerTarget, debugTargetKey, guardDebugAction } from '../operations/debug-target'

export function createCodexDebugDispatcher() {
  let pending: { id: string; path: string; target: string } | null = null
  return {
    arm: (id: string, path: string, target: string) => {
      pending = { id, path, target }
    },
    clear: () => {
      pending = null
    },
    take: (state: CodexState, target: string) => {
      if (!pending) return null
      if (
        state.projectPath !== pending.path ||
        target !== pending.target ||
        state.error ||
        !state.account ||
        state.connection !== 'connected'
      ) {
        pending = null
        return null
      }
      if (state.busy || state.operationPending) return null
      const action = state.messages.find(
        (m) => m.role === 'assistant' && !m.scratchOnly && m.debugAction?.requestId === pending!.id,
      )?.debugAction
      if (!action) return null
      const expected = pending
      pending = null
      return action.base.projectPath === expected.path ? { action, target: expected.target } : null
    },
  }
}
