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
  id?: string
  type?: string | null
  data: unknown
}

type GraphicalDebugEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

type LdContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
type LdCoilVariant = LdContactVariant | 'set' | 'reset'

type LdCoilDebugState = {
  inputPower: GraphicalDebugSample
  assignedValue: boolean | undefined
  actualValue: boolean | undefined
  differs: boolean
  quality: GraphicalDebugQuality
}

type CollectGraphicalDebugWatchKeysOptions = {
  nodes: GraphicalDebugNode[]
  edges?: GraphicalDebugEdge[]
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
  edges,
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

    const connectedHandles = edges
      ? new Set(
          edges
            .filter((edge) => edge.source === node.id && edge.sourceHandle)
            .map((edge) => edge.sourceHandle?.toUpperCase()),
        )
      : undefined
    const outputVariables = [...(data.variant.variables ?? [])].filter(
      (variable) =>
        isOutput(variable) &&
        (!connectedHandles || (variable.name && connectedHandles.has(variable.name.toUpperCase()))),
    )
    if (
      data.executionControl &&
      (!connectedHandles || connectedHandles.has('ENO')) &&
      !outputVariables.some((variable) => variable.name?.toUpperCase() === 'ENO')
    ) {
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

const qualityRank: Record<GraphicalDebugQuality, number> = {
  'exact-runtime': 0,
  'exact-derived': 1,
  sampled: 2,
  estimated: 3,
  stale: 4,
  unavailable: 5,
  'type-error': 6,
  'build-mismatch': 7,
}

const weakestGraphicalDebugQuality = (...qualities: GraphicalDebugQuality[]): GraphicalDebugQuality =>
  qualities.reduce(
    (weakest, quality) => (qualityRank[quality] > qualityRank[weakest] ? quality : weakest),
    'exact-derived',
  )

const booleanSample = (value: boolean | undefined, quality: GraphicalDebugQuality): GraphicalDebugSample => ({
  value: value === undefined ? undefined : value ? 'TRUE' : 'FALSE',
  quality,
})

const applyGraphicalBooleanNegation = (
  sample: GraphicalDebugSample,
  negated: boolean | undefined,
): GraphicalDebugSample => {
  if (!negated) return sample
  const value = parseGraphicalDebugBoolean(sample)
  if (value === undefined) {
    return sample.quality === 'sampled' ? { value: sample.value, quality: 'type-error' } : sample
  }
  return booleanSample(!value, sample.quality)
}

const resolveFbdEdgeSamples = (
  nodes: GraphicalDebugNode[],
  edges: GraphicalDebugEdge[],
  readNodeOutput: (nodeId: string, sourceHandle: string | null | undefined) => GraphicalDebugSample,
): Map<string, GraphicalDebugSample> => {
  const samples = new Map<string, GraphicalDebugSample>()
  const unavailable = (): GraphicalDebugSample => ({ value: undefined, quality: 'unavailable' })

  const resolve = (edgeId: string, visited = new Set<string>()): GraphicalDebugSample => {
    const cached = samples.get(edgeId)
    if (cached) return cached
    if (visited.has(edgeId)) return unavailable()
    visited.add(edgeId)
    const edge = edges.find((candidate) => candidate.id === edgeId)
    const sourceNode = edge ? nodes.find((candidate) => candidate.id === edge.source) : undefined
    if (!edge || !sourceNode) {
      const sample = unavailable()
      samples.set(edgeId, sample)
      visited.delete(edgeId)
      return sample
    }

    const passThrough = sourceNode.type === 'connector' || sourceNode.type === 'continuation'
    const incoming = passThrough
      ? edges
          .filter((candidate) => candidate.target === sourceNode.id)
          .map((candidate) => resolve(candidate.id, visited))
          .find((sample) => sample.quality !== 'unavailable')
      : undefined
    const sample = passThrough ? incoming ?? unavailable() : readNodeOutput(edge.source, edge.sourceHandle)
    samples.set(edgeId, sample)
    visited.delete(edgeId)
    return sample
  }

  for (const edge of edges) resolve(edge.id)
  return samples
}

const combineLdParallelInputs = (inputs: GraphicalDebugSample[]): GraphicalDebugSample => {
  if (inputs.length === 0) return booleanSample(false, 'exact-derived')
  const parsed = inputs.map(parseGraphicalDebugBoolean)
  if (parsed.some((value) => value === true)) {
    const decisive = inputs.filter((_, index) => parsed[index] === true).map((sample) => sample.quality)
    return booleanSample(true, weakestGraphicalDebugQuality(...decisive))
  }
  if (parsed.every((value) => value === false)) {
    return booleanSample(false, weakestGraphicalDebugQuality(...inputs.map((sample) => sample.quality)))
  }
  return { value: undefined, quality: weakestGraphicalDebugQuality(...inputs.map((sample) => sample.quality)) }
}

const evaluateLdContact = (
  inputPower: GraphicalDebugSample,
  variable: GraphicalDebugSample,
  variant: LdContactVariant,
  sampledEdge?: boolean,
): GraphicalDebugSample => {
  const input = parseGraphicalDebugBoolean(inputPower)
  if (input === false) return booleanSample(false, inputPower.quality)
  if (input === undefined) return { value: undefined, quality: inputPower.quality }

  if (variant === 'risingEdge' || variant === 'fallingEdge') {
    if (sampledEdge === undefined) return { value: undefined, quality: 'estimated' }
    return booleanSample(sampledEdge, 'estimated')
  }

  const current = parseGraphicalDebugBoolean(variable)
  if (current === undefined) return { value: undefined, quality: variable.quality }
  return booleanSample(
    variant === 'negated' ? !current : current,
    weakestGraphicalDebugQuality(inputPower.quality, variable.quality),
  )
}

const evaluateLdCoil = (
  inputPower: GraphicalDebugSample,
  actualVariable: GraphicalDebugSample,
  variant: LdCoilVariant,
): LdCoilDebugState => {
  const input = parseGraphicalDebugBoolean(inputPower)
  const actualValue = parseGraphicalDebugBoolean(actualVariable)
  let assignedValue: boolean | undefined
  let quality = weakestGraphicalDebugQuality(inputPower.quality, actualVariable.quality)

  if (input !== undefined) {
    if (variant === 'default') assignedValue = input
    else if (variant === 'negated') assignedValue = !input
    else if (variant === 'set') assignedValue = input ? true : undefined
    else if (variant === 'reset') assignedValue = input ? false : undefined
    else {
      assignedValue = undefined
      quality = 'estimated'
    }
  }

  return {
    inputPower,
    assignedValue,
    actualValue,
    differs: assignedValue !== undefined && actualValue !== undefined && assignedValue !== actualValue,
    quality,
  }
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

const getGraphicalDebugSourcesForStatement = (
  metadata: IecDebugMetadata | null,
  pouId: number,
  statementId: number,
): { primary: IecGraphicalDebugBinding | undefined; secondary: IecGraphicalDebugBinding[] } => {
  const candidates = (metadata?.graphical_bindings ?? [])
    .filter((binding) => binding.pou_id === pouId && binding.statement_ids.includes(statementId))
    .sort((left, right) => {
      const leftDirect = left.breakpoint_statement_id === statementId ? 0 : 1
      const rightDirect = right.breakpoint_statement_id === statementId ? 0 : 1
      if (leftDirect !== rightDirect) return leftDirect - rightDirect
      const kindRank = { block: 0, coil: 0, 'output-variable': 1 } as const
      return kindRank[left.kind] - kindRank[right.kind] || left.node_id.localeCompare(right.node_id)
    })
  return { primary: candidates[0], secondary: candidates.slice(1) }
}

const getGraphicalIecDebugNodeState = (
  metadata: IecDebugMetadata | null,
  status: IecDebugStatus | null,
  breakpoints: ReadonlySet<number>,
  pouName: string,
  nodeId: string,
  rungId?: string,
  selectedInstanceId?: number,
) => {
  const binding = findGraphicalDebugBinding(metadata, pouName, nodeId, rungId)
  const currentSources = status
    ? getGraphicalDebugSourcesForStatement(metadata, status.currentPouId, status.currentStatementId)
    : { primary: undefined, secondary: [] }
  const instanceMatches = selectedInstanceId === undefined || status?.currentInstanceId === selectedInstanceId
  const isSameBinding = (candidate: IecGraphicalDebugBinding | undefined) =>
    candidate?.pou_id === binding?.pou_id &&
    candidate?.node_id === binding?.node_id &&
    candidate?.rung_id === binding?.rung_id
  return {
    binding,
    isCurrent: status?.state === 1 && instanceMatches && isSameBinding(currentSources.primary),
    isSecondaryCurrent:
      status?.state === 1 && instanceMatches && currentSources.secondary.some((candidate) => isSameBinding(candidate)),
    hasBreakpoint: binding ? breakpoints.has(binding.breakpoint_statement_id) : false,
  }
}

export {
  applyGraphicalBooleanNegation,
  collectGraphicalDebugWatchKeys,
  combineLdParallelInputs,
  evaluateLdCoil,
  evaluateLdContact,
  findGraphicalDebugBinding,
  getGraphicalDebugSample,
  getGraphicalDebugSourcesForStatement,
  getGraphicalIecDebugNodeState,
  GRAPHICAL_DEBUG_STALE_AFTER_MS,
  parseGraphicalDebugBoolean,
  resolveFbdEdgeSamples,
  weakestGraphicalDebugQuality,
}
export type {
  GraphicalDebugEdge,
  GraphicalDebugNode,
  GraphicalDebugQuality,
  GraphicalDebugSample,
  LdCoilDebugState,
  LdCoilVariant,
  LdContactVariant,
}
