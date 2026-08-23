import type { FbInstanceInfo } from '@root/types/debugger'
import type {
  IecDebugBreakpoint,
  IecDebugInstance,
  IecDebugMetadata,
  IecDebugStatement,
  IecDebugVariable,
} from '@root/types/PLC/iec-debug'

const iecDebugValueSize = (type: number): number => {
  if ([1, 2, 3, 17].includes(type)) return 1
  if ([4, 5, 18].includes(type)) return 2
  if ([6, 7, 10, 19].includes(type)) return 4
  if ([8, 9, 11, 12, 13, 14, 15, 20].includes(type)) return 8
  if (type === 16) return 127
  return 0
}

const formatIecDebugValue = (variable: IecDebugVariable, bytes: number[]): string => {
  const value = Uint8Array.from(bytes)
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (variable.type_code === 1) return value[0] ? 'TRUE' : 'FALSE'
  if (variable.type_code === 2) return view.getInt8(0).toString()
  if ([3, 17].includes(variable.type_code)) return view.getUint8(0).toString()
  if (variable.type_code === 4) return view.getInt16(0, true).toString()
  if ([5, 18].includes(variable.type_code)) return view.getUint16(0, true).toString()
  if (variable.type_code === 6) return view.getInt32(0, true).toString()
  if ([7, 19].includes(variable.type_code)) return view.getUint32(0, true).toString()
  if (variable.type_code === 8) return view.getBigInt64(0, true).toString()
  if ([9, 20].includes(variable.type_code)) return view.getBigUint64(0, true).toString()
  if (variable.type_code === 10) return view.getFloat32(0, true).toString()
  if (variable.type_code === 11) return view.getFloat64(0, true).toString()
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const encodeIecDebugLiteral = (variable: IecDebugVariable, literal: string): number[] | null => {
  const size = iecDebugValueSize(variable.type_code)
  if (size <= 0 || size > 8) return null
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  const normalized = literal.trim().toUpperCase()
  const numeric = Number(literal)
  const integerBounds: Partial<Record<number, [number, number]>> = {
    2: [-0x80, 0x7f],
    3: [0, 0xff],
    4: [-0x8000, 0x7fff],
    5: [0, 0xffff],
    6: [-0x80000000, 0x7fffffff],
    7: [0, 0xffffffff],
    17: [0, 0xff],
    18: [0, 0xffff],
    19: [0, 0xffffffff],
  }
  try {
    if (variable.type_code === 1) {
      if (!['TRUE', 'FALSE', '1', '0'].includes(normalized)) return null
      view.setUint8(0, ['TRUE', '1'].includes(normalized) ? 1 : 0)
    } else if (variable.type_code >= 2 && variable.type_code <= 7) {
      if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null
      const bounds = integerBounds[variable.type_code]!
      if (numeric < bounds[0] || numeric > bounds[1]) return null
      if (variable.type_code === 2) view.setInt8(0, numeric)
      else if (variable.type_code === 3) view.setUint8(0, numeric)
      else if (variable.type_code === 4) view.setInt16(0, numeric, true)
      else if (variable.type_code === 5) view.setUint16(0, numeric, true)
      else if (variable.type_code === 6) view.setInt32(0, numeric, true)
      else view.setUint32(0, numeric, true)
    } else if ([17, 18, 19].includes(variable.type_code)) {
      if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null
      const bounds = integerBounds[variable.type_code]!
      if (numeric < bounds[0] || numeric > bounds[1]) return null
      if (variable.type_code === 17) view.setUint8(0, numeric)
      else if (variable.type_code === 18) view.setUint16(0, numeric, true)
      else view.setUint32(0, numeric, true)
    } else if (variable.type_code === 8) {
      const value = BigInt(literal)
      if (value < -(1n << 63n) || value > (1n << 63n) - 1n) return null
      view.setBigInt64(0, value, true)
    } else if ([9, 20].includes(variable.type_code)) {
      const value = BigInt(literal)
      if (value < 0n || value > (1n << 64n) - 1n) return null
      view.setBigUint64(0, value, true)
    } else if (variable.type_code === 10) {
      if (!Number.isFinite(numeric)) return null
      view.setFloat32(0, numeric, true)
    } else if (variable.type_code === 11) {
      if (!Number.isFinite(numeric)) return null
      view.setFloat64(0, numeric, true)
    } else return null
  } catch {
    return null
  }
  return Array.from(bytes)
}

type IecBreakpointSpecificationContext = {
  metadata: IecDebugMetadata
  statement: IecDebugStatement
  currentInstance?: IecDebugInstance
}

const resolveIecDebugInstance = (
  metadata: IecDebugMetadata | null,
  pouName: string,
  currentInstanceId?: number,
  selectedPath?: string,
): IecDebugInstance | undefined => {
  if (!metadata) return undefined
  const pou = metadata.pous.find((candidate) => candidate.name.toUpperCase() === pouName.toUpperCase())
  if (!pou) return undefined
  if (selectedPath) {
    const selected = metadata.instances.find(
      (instance) => instance.pou_id === pou.id && instance.path.toUpperCase() === selectedPath.toUpperCase(),
    )
    if (selected) return selected
  }
  return (
    metadata.instances.find((instance) => instance.pou_id === pou.id && instance.id === currentInstanceId) ??
    metadata.instances.find((instance) => instance.pou_id === pou.id)
  )
}

const buildFbDebugInstanceMap = (metadata: IecDebugMetadata): Map<string, FbInstanceInfo[]> => {
  const byPouType = new Map<string, FbInstanceInfo[]>()
  const pousById = new Map(metadata.pous.map((pou) => [pou.id, pou]))
  for (const instance of metadata.instances) {
    if (instance.kind !== 'function-block') continue
    const instancePou = pousById.get(instance.pou_id)
    if (!instancePou) continue
    const pathSegments = instance.path.split('.').filter(Boolean)
    if (pathSegments.length < 2) continue
    const programName = pathSegments[0]
    const fbVariableName = pathSegments.slice(1).join('.')
    const typeKey = instancePou.name.toUpperCase()
    const instances = byPouType.get(typeKey) ?? []
    instances.push({
      fbTypeName: instancePou.name,
      programName,
      programInstanceName: instance.source_path.split('.')[0] || programName,
      fbVariableName,
      key: `${programName}:${fbVariableName}`,
      path: instance.path,
      instanceId: instance.id,
      pouId: instance.pou_id,
    })
    byPouType.set(typeKey, instances)
  }
  byPouType.forEach((instances) => instances.sort((left, right) => (left.path ?? '').localeCompare(right.path ?? '')))
  return byPouType
}

const buildIecDebugBreakpoint = (
  { metadata, statement, currentInstance }: IecBreakpointSpecificationContext,
  specification: string,
): IecDebugBreakpoint => {
  const breakpoint: IecDebugBreakpoint = { statementId: statement.id }
  const parts = specification
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  let selectedInstance: IecDebugInstance | undefined
  const instancePart = parts.find((part) => part.toLowerCase().startsWith('instance='))
  if (instancePart) {
    const requested = instancePart.slice(instancePart.indexOf('=') + 1).trim()
    selectedInstance =
      requested.toLowerCase() === 'current'
        ? currentInstance
        : metadata.instances.find(
            (candidate) =>
              candidate.pou_id === statement.pou_id && candidate.path.toUpperCase() === requested.toUpperCase(),
          )
    if (!selectedInstance || selectedInstance.pou_id !== statement.pou_id) {
      const pouName = metadata.pous.find((pou) => pou.id === statement.pou_id)?.name ?? 'IEC'
      throw new Error(`Unknown ${pouName} instance '${requested}'`)
    }
    breakpoint.instanceId = selectedInstance.id
  }
  const availableVariables = selectedInstance
    ? metadata.variables.filter((variable) => variable.instance_id === selectedInstance.id)
    : metadata.variables

  for (const part of parts) {
    if (part.toLowerCase().startsWith('instance=')) continue
    if (part.toLowerCase().startsWith('hit=')) {
      const hitTarget = Number(part.slice(part.indexOf('=') + 1))
      if (!Number.isInteger(hitTarget) || hitTarget <= 0) throw new Error('Hit count must be a positive integer')
      breakpoint.hitTarget = hitTarget
      continue
    }
    if (part.toLowerCase().startsWith('change=')) {
      if (!selectedInstance) throw new Error('Break on change requires an explicit instance')
      const requested = part
        .slice(part.indexOf('=') + 1)
        .trim()
        .toUpperCase()
      const variable = availableVariables.find(
        (candidate) =>
          candidate.path.toUpperCase() === requested || candidate.path.toUpperCase().endsWith(`.${requested}`),
      )
      if (!variable) throw new Error(`Unknown local IEC variable '${requested}'`)
      const size = iecDebugValueSize(variable.type_code)
      if (size <= 0 || size > 8) throw new Error(`Break on change does not support ${variable.type}`)
      breakpoint.change = { variableId: variable.id, type: variable.type_code, size }
      continue
    }

    const condition = part.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
    if (!condition) throw new Error(`Unknown breakpoint option '${part}'`)
    if (!selectedInstance) throw new Error('A conditional breakpoint requires an explicit instance')
    const requested = condition[1].trim().toUpperCase()
    const variable = availableVariables.find(
      (candidate) =>
        candidate.path.toUpperCase() === requested || candidate.path.toUpperCase().endsWith(`.${requested}`),
    )
    if (!variable) throw new Error(`Unknown local IEC variable '${condition[1].trim()}'`)
    const value = encodeIecDebugLiteral(variable, condition[3])
    if (!value) throw new Error(`Conditions do not support ${variable.type}`)
    breakpoint.condition = {
      variableId: variable.id,
      type: variable.type_code,
      operator: condition[2] as NonNullable<IecDebugBreakpoint['condition']>['operator'],
      value,
    }
  }

  return breakpoint
}

export {
  buildFbDebugInstanceMap,
  buildIecDebugBreakpoint,
  encodeIecDebugLiteral,
  formatIecDebugValue,
  iecDebugValueSize,
  resolveIecDebugInstance,
}
export type { IecBreakpointSpecificationContext }
