import { z } from 'zod'

import type { McpAction } from '../IPC/mcp'
import { isDebugExecution } from './debugger'

export const plcAiSettingsSchema = z
  .object({
    includeContext: z.boolean(),
    includeDebugger: z.boolean(),
    activeDebugger: z.boolean(),
    proposeChanges: z.boolean(),
    directEdits: z.boolean(),
  })
  .strict()
export type PlcAiSettings = z.infer<typeof plcAiSettingsSchema>

export const defaultPlcAiSettings: PlcAiSettings = {
  includeContext: true,
  includeDebugger: false,
  activeDebugger: true,
  proposeChanges: true,
  directEdits: true,
}

/** Host settings only. A model/tool argument must never select its own permissions. */
export function mcpDisposition(action: McpAction, settings: PlcAiSettings | null): 'queued' | 'review-required' {
  // Older host callers keep their explicit review behavior.
  if (!settings) return 'review-required'
  if (!settings.includeContext) throw new Error('Project access is disabled in the shared AI settings.')
  if (action.operation === 'changes' || action.operation === 'undo') {
    if (!settings.proposeChanges) throw new Error('ST / C++ editing is disabled in the shared AI settings.')
    return settings.directEdits ? 'queued' : 'review-required'
  }
  if (action.operation === 'debug') {
    if (!settings.activeDebugger) throw new Error('Active debugger commands are disabled in the shared AI settings.')
    if (isDebugExecution(action.command.operation)) return 'review-required'
  }
  return 'queued'
}
