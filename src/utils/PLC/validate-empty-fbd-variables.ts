import type { PLCProjectData } from '@root/types/PLC/open-plc'

export type EmptyFbdVariable = {
  pouName: string
  kind: 'input' | 'output'
  connectedTo: string | null
  x: number
  y: number
}

const VARIABLE_NODE_KINDS: Record<string, EmptyFbdVariable['kind']> = {
  'input-variable': 'input',
  'output-variable': 'output',
}

type FbdNodeData = { variable?: { name?: string }; variant?: { name?: string } }
type FbdRung = {
  nodes: ReadonlyArray<{ id: string; type?: string; data?: unknown; position: { x: number; y: number } }>
  edges: ReadonlyArray<{
    source: string
    sourceHandle?: string | null
    target: string
    targetHandle?: string | null
  }>
}

const nodeLabel = (data: unknown): string | undefined => {
  const { variable, variant } = (data ?? {}) as FbdNodeData
  return variable?.name?.trim() || variant?.name?.trim() || undefined
}

const describeConnection = (nodeId: string, kind: EmptyFbdVariable['kind'], rung: FbdRung): string | null => {
  const edge =
    kind === 'output' ? rung.edges.find((item) => item.target === nodeId) : rung.edges.find((item) => item.source === nodeId)
  if (!edge) return null

  const neighbourId = kind === 'output' ? edge.source : edge.target
  const handle = kind === 'output' ? edge.sourceHandle : edge.targetHandle
  const neighbour = rung.nodes.find((node) => node.id === neighbourId)
  if (!neighbour) return null

  const label = nodeLabel(neighbour.data)
  if (neighbour.type === 'block' && handle) {
    return label ? `"${handle}" of "${label}"` : `the "${handle}" pin of a block`
  }
  return label ? `"${label}"` : null
}

export const findEmptyFbdVariables = (projectData: PLCProjectData): EmptyFbdVariable[] => {
  const issues: EmptyFbdVariable[] = []

  projectData.pous.forEach((pou) => {
    if (pou.data.body.language !== 'fbd') return

    const rung = pou.data.body.value.rung as FbdRung
    rung.nodes.forEach((node) => {
      const kind = VARIABLE_NODE_KINDS[node.type ?? '']
      if (!kind) return

      const name = (node.data as FbdNodeData | undefined)?.variable?.name
      if (name?.trim()) return

      issues.push({
        pouName: pou.data.name,
        kind,
        connectedTo: describeConnection(node.id, kind, rung),
        x: node.position.x,
        y: node.position.y,
      })
    })
  })

  return issues
}
