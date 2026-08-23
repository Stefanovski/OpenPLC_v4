import type { IecDebugMetadata, IecDebugStatus, IecGraphicalDebugBinding } from '@root/types/PLC/iec-debug'

const GRAPHICAL_DEBUG_STALE_AFTER_MS = 1000

type GraphicalDebugQuality =
  | 'exact-runtime'
  | 'exact-derived'
  | 'sampled'
  | 'estimated'
  | 'stale'
  | 'unavailable'
  | 'type-error'
  | 'build-mismatch'

type GraphicalDebugSample = {
  value: string | undefined
  quality: GraphicalDebugQuality
}

type GraphicalDebugVariable = {
  name?: string
  class?: string
  type?: { definition?: string; value?: string }
}

type GraphicalDebugNode = {
  type?: string | null
  data: unknown
}

type CollectGraphicalDebugWatchKeysOptions = {
  nodes: GraphicalDebugNode[]
  makeCompositeKey: (variableName: string) => string | null
  availableKeys: ReadonlySet<string>
}

const isOutput = (variable: GraphicalDebugVariable) => variable.class === 'output' || variable.class === 'inOut'

/**
 * Builds the smallest watch set needed to render the currently visible LD/FBD graph.
 * The graph topology stays entirely in the editor; the target only supplies normal
 * IEC variable samples that already exist in the GELB debugger protocol.
 */
const collectGraphicalDebugWatchKeys = ({
  nodes,
  makeCompositeKey,
  availableKeys,
}: CollectGraphicalDebugWatchKeysOptions): Set<string> => {
  const watchKeys = new Set<string>()

  const addVariable = (variableName: string | undefined) => {
    if (!variableName) return
    const compositeKey = makeCompositeKey(variableName)
    if (compositeKey && availableKeys.has(compositeKey)) watchKeys.add(compositeKey)
  }

  for (const node of nodes) {
    const data = node.data as {
      variable?: GraphicalDebugVariable
      numericId?: string
      executionControl?: boolean
      variant?: {
        name?: string
        type?: string
        variables?: GraphicalDebugVariable[]
      }
    }

    if (
      node.type === 'contact' ||
      node.type === 'coil' ||
      node.type === 'variable' ||
      node.type === 'input-variable' ||
      node.type === 'output-variable' ||
      node.type === 'inout-variable'
    ) {
      addVariable(data.variable?.name)
    }

    if (node.type !== 'block' || !data.variant) continue

    const outputVariables = [...(data.variant.variables ?? [])].filter(isOutput)
    if (data.executionControl && !outputVariables.some((variable) => variable.name?.toUpperCase() === 'ENO')) {
      outputVariables.push({ name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } })
    }

    if (data.variant.type === 'function-block') {
      for (const outputVariable of outputVariables) {
        if (data.variable?.name && outputVariable.name) {
          addVariable(`${data.variable.name}.${outputVariable.name}`)
        }
      }
    } else if (data.variant.type === 'function' && data.variant.name && data.numericId) {
      for (const outputVariable of outputVariables) {
        if (outputVariable.name) {
          addVariable(`_TMP_${data.variant.name.toUpperCase()}${data.numericId}_${outputVariable.name.toUpperCase()}`)
        }
      }
    }
  }

  return watchKeys
}

const getGraphicalDebugSample = (
  values: ReadonlyMap<string, string>,
  updatedAt: ReadonlyMap<string, number>,
  compositeKey: string,
  now = Date.now(),
): GraphicalDebugSample => {
  const value = values.get(compositeKey)
  const timestamp = updatedAt.get(compositeKey)

  if (value === undefined || timestamp === undefined) return { value, quality: 'unavailable' }
  if (value === 'ERR') return { value, quality: 'type-error' }
  if (now - timestamp > GRAPHICAL_DEBUG_STALE_AFTER_MS) return { value, quality: 'stale' }
  return { value, quality: 'sampled' }
}

const parseGraphicalDebugBoolean = (sample: GraphicalDebugSample): boolean | undefined => {
  if (
    sample.value === undefined ||
    sample.quality === 'stale' ||
    sample.quality === 'unavailable' ||
    sample.quality === 'type-error' ||
    sample.quality === 'build-mismatch'
  ) {
    return undefined
  }
  const normalized = sample.value.trim().toUpperCase()
  if (normalized === 'TRUE' || normalized === '1') return true
  if (normalized === 'FALSE' || normalized === '0') return false
  return undefined
}

const findGraphicalDebugBinding = (
  metadata: IecDebugMetadata | null,
  pouName: string,
  nodeId: string,
  rungId?: string,
): IecGraphicalDebugBinding | undefined => {
  if (!metadata?.graphical_bindings) return undefined
  const pou = metadata.pous.find((candidate) => candidate.name.toUpperCase() === pouName.toUpperCase())
  if (!pou) return undefined
  return metadata.graphical_bindings.find(
    (binding) =>
      binding.pou_id === pou.id && binding.node_id === nodeId && (rungId === undefined || binding.rung_id === rungId),
  )
}

const getGraphicalIecDebugNodeState = (
  metadata: IecDebugMetadata | null,
  status: IecDebugStatus | null,
  breakpoints: ReadonlySet<number>,
  pouName: string,
  nodeId: string,
  rungId?: string,
) => {
  const binding = findGraphicalDebugBinding(metadata, pouName, nodeId, rungId)
  return {
    binding,
    isCurrent:
      status?.state === 1 &&
      binding?.pou_id === status.currentPouId &&
      binding.statement_ids.includes(status.currentStatementId),
    hasBreakpoint: binding ? breakpoints.has(binding.breakpoint_statement_id) : false,
  }
}

export {
  collectGraphicalDebugWatchKeys,
  findGraphicalDebugBinding,
  getGraphicalDebugSample,
  getGraphicalIecDebugNodeState,
  GRAPHICAL_DEBUG_STALE_AFTER_MS,
  parseGraphicalDebugBoolean,
}
export type { GraphicalDebugNode, GraphicalDebugQuality, GraphicalDebugSample }
