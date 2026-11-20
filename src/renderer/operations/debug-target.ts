import type { PlcDebugRequest } from '@root/types/plc-operations/debugger'

import type { RootState } from '../store'
import { buildPlcContext } from './context'
import { contentKey } from './edits'

export const debugTargetKey = (s: RootState) =>
  JSON.stringify([s.project.meta.path, s.deviceDefinitions.configuration, s.deviceDefinitions.temporaryDhcpIp])
export function debuggerTarget(s: RootState) {
  const c = s.deviceDefinitions.configuration
  if (
    s.deviceAvailableOptions.availableBoards.get(c.deviceBoard)?.compiler !== 'eurosonic-cli' ||
    !c.communicationConfiguration.communicationPreferences.enabledTCP
  )
    throw new Error('Active PLC debugging requires a Eurosonic target with Modbus TCP enabled.')
  const host = c.communicationConfiguration.communicationPreferences.enabledDHCP
    ? s.deviceDefinitions.temporaryDhcpIp
    : c.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress
  if (!host)
    throw new Error('Enter PLC target IP (DHCP) in the assistant sidebar, or set the static IP in Configuration.')
  return host
}
export function guardDebugAction(s: RootState, action: PlcDebugRequest, targetKey: string) {
  if (s.workspace.isDebuggerVisible || s.workspace.debuggerTargetIp)
    throw new Error('Disconnect the ordinary PLC debugger before using the PLC operations debugger.')
  if (s.workspace.editingState === 'save-request') throw new Error('Wait for the save operation.')
  if (debugTargetKey(s) !== targetKey || contentKey(buildPlcContext(s)) !== contentKey(action.base))
    throw new Error('Project or target changed since the debugger request. Ask again; nothing was executed.')
}
