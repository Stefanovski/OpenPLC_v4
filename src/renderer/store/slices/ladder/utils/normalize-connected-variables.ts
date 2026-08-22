import type { LadderBlockConnectedVariables } from '@root/renderer/components/_atoms/graphical-editor/ladder/block'

export const normalizeConnectedVariables = (raw: unknown): LadderBlockConnectedVariables => {
  if (Array.isArray(raw)) return raw as LadderBlockConnectedVariables
  if (!raw || typeof raw !== 'object') return []

  type ConnectedVariable = LadderBlockConnectedVariables[number]['variable']
  return Object.entries(raw as Record<string, { variable?: ConnectedVariable; type?: string }>).map(
    ([handleId, value]) => ({
      handleId,
      variable: value.variable,
      type: value.type === 'output' ? 'output' : 'input',
    }),
  )
}
