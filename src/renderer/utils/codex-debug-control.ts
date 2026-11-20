import type { CodexState } from '@root/types/IPC/codex'
import type { CodexDebugAction } from '@root/types/IPC/codex-debug-control'

import type { RootState } from '../store'
import { buildCodexContext } from './codex-context'
import { contentKey } from './codex-edits'

export const debugTargetKey = (s: RootState) =>
  JSON.stringify([s.project.meta.path, s.deviceDefinitions.configuration, s.deviceDefinitions.temporaryDhcpIp])
export function debuggerTarget(s: RootState) {
  const c = s.deviceDefinitions.configuration
  if (
    s.deviceAvailableOptions.availableBoards.get(c.deviceBoard)?.compiler !== 'eurosonic-cli' ||
    !c.communicationConfiguration.communicationPreferences.enabledTCP
  )
    throw new Error('Active Codex debugging requires a Eurosonic target with Modbus TCP enabled.')
  const host = c.communicationConfiguration.communicationPreferences.enabledDHCP
    ? s.deviceDefinitions.temporaryDhcpIp
    : c.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress
  if (!host) throw new Error('Enter PLC target IP (DHCP) in the Codex sidebar, or set the static IP in Configuration.')
  return host
}
export function guardDebugAction(s: RootState, action: CodexDebugAction, targetKey: string) {
  if (s.workspace.isDebuggerVisible || s.workspace.debuggerTargetIp)
    throw new Error('Disconnect the ordinary PLC debugger before using the Codex debugger.')
  if (s.workspace.editingState === 'save-request') throw new Error('Wait for the save operation.')
  if (debugTargetKey(s) !== targetKey || contentKey(buildCodexContext(s)) !== contentKey(action.base))
    throw new Error('Project or target changed since the debugger request. Ask again; nothing was executed.')
}
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
