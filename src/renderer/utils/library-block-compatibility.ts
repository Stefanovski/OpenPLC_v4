import type { LibraryState } from '@root/renderer/store/slices'
import type { PLCPou, PLCProjectData } from '@root/types/PLC/open-plc'

type LibraryBlockPort = {
  id?: string
  name: string
  class?: string
  type: {
    definition: string
    value: string
    data?: unknown
  }
  [key: string]: unknown
}

export type ResolvedLibraryBlock = {
  name: string
  type: string
  variables: LibraryBlockPort[]
  returnType?: string
  [key: string]: unknown
}

export type LibraryBlockInterfaceChange = {
  name: string
  kind: 'added' | 'removed' | 'changed'
  previous?: { class?: string; type: string }
  current?: { class?: string; type: string }
}

export type OutdatedLibraryBlock = {
  pouName: string
  language: 'fbd' | 'ld'
  nodeId: string
  instanceName?: string
  blockName: string
  changes: LibraryBlockInterfaceChange[]
}

const normalizeName = (value: string | undefined) => value?.trim().toUpperCase() ?? ''

const normalizePort = (port: LibraryBlockPort) => ({
  class: port.class,
  type: normalizeName(port.type?.value),
  definition: normalizeName(port.type?.definition),
})

const isInterfacePort = (port: LibraryBlockPort) =>
  ['input', 'output', 'inOut'].includes(port.class ?? '') && !['EN', 'ENO'].includes(normalizeName(port.name))

const convertProjectPouToLibraryBlock = (pou: PLCPou): ResolvedLibraryBlock => {
  const variables = pou.data.variables.map((variable) => ({
    ...variable,
    type: {
      ...variable.type,
      value: variable.type.value.toUpperCase(),
    },
  })) as LibraryBlockPort[]

  if (pou.type === 'function' && !variables.some((variable) => normalizeName(variable.name) === 'OUT')) {
    variables.push({
      name: 'OUT',
      class: 'output',
      type: {
        definition: 'derived',
        value: pou.data.returnType.toUpperCase(),
      },
    })
  }

  return {
    ...pou.data,
    name: pou.data.name,
    type: pou.type,
    variables,
    returnType: pou.type === 'function' ? pou.data.returnType : undefined,
  }
}

export const resolveCurrentLibraryBlock = (
  libraries: LibraryState['libraries'],
  projectPous: PLCPou[],
  blockName: string,
  blockType?: string,
): ResolvedLibraryBlock | undefined => {
  const normalizedBlockName = normalizeName(blockName)
  const normalizedBlockType = normalizeName(blockType)
  const userLibrary = libraries.user.find(
    (library) =>
      normalizeName(library.name) === normalizedBlockName &&
      (!normalizedBlockType || normalizeName(library.type) === normalizedBlockType),
  )
  const userPou = userLibrary
    ? projectPous.find(
        (pou) =>
          normalizeName(pou.data.name) === normalizeName(userLibrary.name) &&
          (!normalizedBlockType || normalizeName(pou.type) === normalizedBlockType),
      )
    : undefined

  if (userPou) return convertProjectPouToLibraryBlock(userPou)

  const systemLibraries = libraries.system as unknown as { pous: ResolvedLibraryBlock[] }[]
  return systemLibraries
    .flatMap((library) => library.pous)
    .find(
      (pou) =>
        normalizeName(pou.name) === normalizedBlockName &&
        (!normalizedBlockType || normalizeName(pou.type) === normalizedBlockType),
    )
}

export const getLibraryBlockInterfaceChanges = (
  storedBlock: ResolvedLibraryBlock,
  currentBlock: ResolvedLibraryBlock,
): LibraryBlockInterfaceChange[] => {
  const storedPorts = storedBlock.variables.filter(isInterfacePort)
  const currentPorts = currentBlock.variables.filter(isInterfacePort)
  const storedByName = new Map(storedPorts.map((port) => [normalizeName(port.name), port]))
  const currentByName = new Map(currentPorts.map((port) => [normalizeName(port.name), port]))
  const changes: LibraryBlockInterfaceChange[] = []

  currentPorts.forEach((currentPort) => {
    const storedPort = storedByName.get(normalizeName(currentPort.name))
    if (!storedPort) {
      changes.push({
        name: currentPort.name,
        kind: 'added',
        current: { class: currentPort.class, type: normalizeName(currentPort.type.value) },
      })
      return
    }

    const stored = normalizePort(storedPort)
    const current = normalizePort(currentPort)
    if (stored.class !== current.class || stored.type !== current.type || stored.definition !== current.definition) {
      changes.push({
        name: currentPort.name,
        kind: 'changed',
        previous: { class: storedPort.class, type: normalizeName(storedPort.type.value) },
        current: { class: currentPort.class, type: normalizeName(currentPort.type.value) },
      })
    }
  })

  storedPorts.forEach((storedPort) => {
    if (currentByName.has(normalizeName(storedPort.name))) return
    changes.push({
      name: storedPort.name,
      kind: 'removed',
      previous: { class: storedPort.class, type: normalizeName(storedPort.type.value) },
    })
  })

  return changes
}

export const isLibraryBlockOutdated = (storedBlock: ResolvedLibraryBlock, currentBlock: ResolvedLibraryBlock) =>
  getLibraryBlockInterfaceChanges(storedBlock, currentBlock).length > 0

const readInstanceName = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return undefined
  const variable = (data as { variable?: unknown }).variable
  if (!variable || typeof variable !== 'object') return undefined
  const name = (variable as { name?: unknown }).name
  return typeof name === 'string' && name.trim().length > 0 ? name : undefined
}

export const findOutdatedLibraryBlocks = (
  projectData: PLCProjectData,
  libraries: LibraryState['libraries'],
): OutdatedLibraryBlock[] => {
  const result: OutdatedLibraryBlock[] = []

  projectData.pous.forEach((pou) => {
    const body = pou.data.body
    if (body.language !== 'fbd' && body.language !== 'ld') return
    const nodeGroups = body.language === 'fbd' ? [body.value.rung.nodes] : body.value.rungs.map((rung) => rung.nodes)

    nodeGroups.forEach((nodes) => {
      nodes.forEach((node) => {
        if (node.type !== 'block' || !node.data || typeof node.data !== 'object') return
        const variant = (node.data as { variant?: ResolvedLibraryBlock }).variant
        if (!variant?.name || !Array.isArray(variant.variables)) return
        const currentBlock = resolveCurrentLibraryBlock(libraries, projectData.pous, variant.name, variant.type)
        if (!currentBlock) return
        const changes = getLibraryBlockInterfaceChanges(variant, currentBlock)
        if (changes.length === 0) return

        result.push({
          pouName: pou.data.name,
          language: body.language,
          nodeId: node.id,
          instanceName: readInstanceName(node.data),
          blockName: variant.name,
          changes,
        })
      })
    })
  })

  return result
}

export const formatLibraryBlockInterfaceChange = (change: LibraryBlockInterfaceChange): string => {
  if (change.kind === 'added') return `${change.name} added (${change.current?.type ?? '?'})`
  if (change.kind === 'removed') return `${change.name} removed (was ${change.previous?.type ?? '?'})`
  return `${change.name} changed (${change.previous?.type ?? '?'} -> ${change.current?.type ?? '?'})`
}
