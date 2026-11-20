import type { CodexState } from '@root/types/IPC/codex'

/** Only a response to a send initiated by this mounted renderer can start a build.
 * Transcript replay, reloads, cancelled requests and repeated state events are inert. */
export function createCodexBuildDispatcher() {
  let pending: { requestId: string; projectPath: string } | null = null
  return {
    arm(requestId: string, projectPath: string) {
      pending = { requestId, projectPath }
    },
    clear() {
      pending = null
    },
    take(state: CodexState) {
      if (!pending) return null
      if (
        state.projectPath !== pending.projectPath ||
        state.connection !== 'connected' ||
        state.error ||
        !state.account
      ) {
        pending = null
        return null
      }
      if (state.busy || state.operationPending) return null
      const request = state.messages.find(
        (m) => m.role === 'assistant' && !m.scratchOnly && m.buildAction?.requestId === pending!.requestId,
      )?.buildAction
      if (!request) return null
      const projectPath = pending.projectPath
      pending = null
      return request.base.projectPath === projectPath ? request : null
    },
  }
}
