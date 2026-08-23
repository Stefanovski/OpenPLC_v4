import { createHash } from 'node:crypto'

import type { ProjectState } from '@root/renderer/store/slices'
import type {
  IecDebugSourceIdentity,
  IecDebugSourceSpan,
  IecGraphicalDebugBinding,
  IecGraphicalPinBinding,
} from '@root/types/PLC/iec-debug'

export const IEC_DEBUG_METADATA_FILE = 'program.debug.json'
export const XML2ST_SOURCE_MAP_FILE = 'program.source-map.json'
export const IEC_DEBUG_VARIABLE_ADAPTER_MARKER = 'EUROSONIC_IEC_DEBUG_VARIABLE_ADAPTER_V1'

export enum IecDebugVariableType {
  Unknown = 0,
  Bool = 1,
  Sint = 2,
  Usint = 3,
  Int = 4,
  Uint = 5,
  Dint = 6,
  Udint = 7,
  Lint = 8,
  Ulint = 9,
  Real = 10,
  Lreal = 11,
  Time = 12,
  Date = 13,
  TimeOfDay = 14,
  DateAndTime = 15,
  String = 16,
  Byte = 17,
  Word = 18,
  Dword = 19,
  Lword = 20,
}

type DebugSourceFile = {
  fileName: string
  content: string
}

export type IecDebugVariable = {
  id: number
  key: string
  name: string
  type: string
  type_code: IecDebugVariableType
  legacy_index: number
  writable: boolean
  instance_id: number
  path: string
}

export type IecDebugInstance = {
  id: number
  key: string
  name: string
  path: string
  source_path: string
  pou_id: number
  parent_id: number
  kind: 'program' | 'function-block'
  c_expression: string
  root_c_symbol: string
  root_type: string
}

type IecDebugMetadata = {
  format: string
  version: number
  id_algorithm: string
  build_id: string
  pous: Array<{ id: number; key: string; name: string; kind: string }>
  statements: Array<{
    id: number
    pou_id: number
    key: string
    file: string
    line: number
    column: number
    end_line: number
    end_column: number
    type: string
  }>
  variables: IecDebugVariable[]
  instances: Array<Omit<IecDebugInstance, 'c_expression' | 'root_c_symbol' | 'root_type'>>
  graphical_bindings?: IecGraphicalDebugBinding[]
  source_identity?: IecDebugSourceIdentity
}

type Xml2stSourceMapChunk = {
  metadata: unknown[]
  graphical: null | {
    pou: string
    kind: string
    local_id: number
    path: unknown[]
  }
  text: string
  quality: string
  span?: IecDebugSourceSpan
}

export type Xml2stSourceMap = {
  format: 'eurosonic-xml2st-source-map'
  version: 1
  project_sha256: string
  st_sha256: string
  st_length: number
  chunks: Xml2stSourceMapChunk[]
}

type GraphicalNodeData = {
  numericId?: string
  variable?: { name?: string }
  variant?: { name?: string; type?: string; variables?: Array<{ name?: string; class?: string }> }
}

type GraphicalNode = {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: unknown
}

const IEC_TYPE_CODES: Readonly<Record<string, IecDebugVariableType>> = {
  BOOL: IecDebugVariableType.Bool,
  SINT: IecDebugVariableType.Sint,
  USINT: IecDebugVariableType.Usint,
  INT: IecDebugVariableType.Int,
  UINT: IecDebugVariableType.Uint,
  DINT: IecDebugVariableType.Dint,
  UDINT: IecDebugVariableType.Udint,
  LINT: IecDebugVariableType.Lint,
  ULINT: IecDebugVariableType.Ulint,
  REAL: IecDebugVariableType.Real,
  LREAL: IecDebugVariableType.Lreal,
  TIME: IecDebugVariableType.Time,
  DATE: IecDebugVariableType.Date,
  TOD: IecDebugVariableType.TimeOfDay,
  DT: IecDebugVariableType.DateAndTime,
  STRING: IecDebugVariableType.String,
  BYTE: IecDebugVariableType.Byte,
  WORD: IecDebugVariableType.Word,
  DWORD: IecDebugVariableType.Dword,
  LWORD: IecDebugVariableType.Lword,
}

export const fnv1a32 = (value: string): number => {
  let hash = 0x811c9dc5
  for (const byte of Buffer.from(value, 'utf8')) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const fnv1a64 = (values: string[]): string => {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const value of values) {
    for (const byte of Buffer.from(`${value}\n`, 'utf8')) {
      hash ^= BigInt(byte)
      hash = (hash * prime) & mask
    }
  }
  return hash.toString(16).padStart(16, '0')
}

const sourceFileName = (pouName: string): string => {
  const safeName = pouName.replace(/[^A-Za-z0-9_.-]/g, '_')
  if (!safeName) throw new Error(`Cannot create an IEC debug source filename for POU '${pouName}'`)
  return `${safeName.toLowerCase()}.st`
}

export const prepareProjectForIecDebug = (
  projectData: ProjectState['data'],
): { projectData: ProjectState['data']; sourceFiles: DebugSourceFile[] } => {
  const debugProject = structuredClone(projectData)
  const sourceFiles: DebugSourceFile[] = []
  const fileNames = new Set<string>()

  for (const pou of debugProject.pous) {
    if (pou.data.body.language !== 'st') continue

    const fileName = sourceFileName(pou.data.name)
    if (fileNames.has(fileName)) throw new Error(`Duplicate IEC debug source filename '${fileName}'`)
    fileNames.add(fileName)

    const source = pou.data.body.value.endsWith('\n') ? pou.data.body.value : `${pou.data.body.value}\n`
    sourceFiles.push({ fileName, content: source })
    pou.data.body = { language: 'st', value: `{#include "${fileName}"}` }
  }

  return { projectData: debugProject, sourceFiles }
}

export const parseIecDebugVariables = (variablesCsv: string): IecDebugVariable[] => {
  const variables: IecDebugVariable[] = []
  const ids = new Map<number, string>()
  let legacyIndex = 0

  for (const rawLine of variablesCsv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue
    const fields = line.split(';')
    const variableClass = fields[1]?.trim().toUpperCase()
    if (!['VAR', 'IN', 'OUT'].includes(variableClass)) continue

    const name = fields[2]?.trim()
    const type = fields[5]?.trim().toUpperCase()
    if (!name || !type) throw new Error(`Invalid variable entry in VARIABLES.csv: '${line}'`)

    const key = `var-v1:${name.toUpperCase()}:${type}`
    const id = fnv1a32(key)
    if (id === 0) throw new Error(`IEC debug variable ID 0 is reserved (key '${key}')`)
    const existing = ids.get(id)
    if (existing && existing !== key) {
      throw new Error(`IEC debug ID collision 0x${id.toString(16).padStart(8, '0')} between '${existing}' and '${key}'`)
    }
    ids.set(id, key)

    variables.push({
      id,
      key,
      name,
      type,
      type_code: IEC_TYPE_CODES[type] ?? IecDebugVariableType.Unknown,
      legacy_index: legacyIndex,
      writable: (IEC_TYPE_CODES[type] ?? IecDebugVariableType.Unknown) !== IecDebugVariableType.Unknown,
      instance_id: 0,
      path: name,
    })
    legacyIndex += 1
  }

  return variables.sort((left, right) => left.id - right.id)
}

const parseProgramRoots = (variablesCsv: string) => {
  const roots: Array<{ sourcePath: string; type: string; cSymbol: string }> = []
  let inPrograms = false
  for (const rawLine of variablesCsv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '// Programs') {
      inPrograms = true
      continue
    }
    if (line === '// Variables') {
      inPrograms = false
      continue
    }
    if (!inPrograms || !line || line.startsWith('//')) continue
    const fields = line.split(';')
    const sourcePath = fields[1]?.trim().toUpperCase()
    const type = fields[2]?.trim().toUpperCase()
    if (!sourcePath || !type) continue
    const segments = sourcePath.split('.')
    if (segments.length < 2) throw new Error(`Invalid IEC program instance path '${sourcePath}'`)
    roots.push({ sourcePath, type, cSymbol: `${segments[segments.length - 2]}__${segments[segments.length - 1]}` })
  }
  return roots
}

const toIecDisplayPath = (path: string): string => path.replace(/\.value\.table/g, '')

export const parseIecDebugInstances = (variablesCsv: string, pous: IecDebugMetadata['pous']): IecDebugInstance[] => {
  const pouByName = new Map(pous.map((pou) => [pou.name.toUpperCase(), pou]))
  const roots = parseProgramRoots(variablesCsv)
  const candidates = roots.map((root) => ({ sourcePath: root.sourcePath, type: root.type, root }))

  let inVariables = false
  for (const rawLine of variablesCsv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '// Variables') {
      inVariables = true
      continue
    }
    if (!inVariables || !line || line.startsWith('//')) continue
    const fields = line.split(';')
    if (fields[1]?.trim().toUpperCase() !== 'FB') continue
    const sourcePath = fields[2]?.trim().toUpperCase()
    const type = fields[4]?.trim().toUpperCase()
    if (!sourcePath || !type || roots.some((root) => root.sourcePath === sourcePath)) continue
    const root = roots
      .filter((entry) => sourcePath.startsWith(`${entry.sourcePath}.`))
      .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0]
    if (root) candidates.push({ sourcePath, type, root })
  }

  const instances: IecDebugInstance[] = []
  for (const candidate of candidates.sort((left, right) => left.sourcePath.length - right.sourcePath.length)) {
    const pou = pouByName.get(candidate.type)
    if (!pou) continue
    const suffix = candidate.sourcePath.slice(candidate.root.sourcePath.length).replace(/^\./, '')
    const path = suffix ? `${candidate.root.type}.${toIecDisplayPath(suffix)}` : candidate.root.type
    const key = `instance-v1:${path}:${candidate.type}`
    const id = fnv1a32(key)
    if (id === 0) throw new Error(`IEC debug instance ID 0 is reserved (key '${key}')`)
    const parent = instances
      .filter((instance) => candidate.sourcePath.startsWith(`${instance.source_path}.`))
      .sort((left, right) => right.source_path.length - left.source_path.length)[0]
    instances.push({
      id,
      key,
      name: path.split('.').at(-1) ?? path,
      path,
      source_path: candidate.sourcePath,
      pou_id: pou.id,
      parent_id: parent?.id ?? 0,
      kind: suffix ? 'function-block' : 'program',
      c_expression: suffix ? `${candidate.root.cSymbol}.${suffix}` : candidate.root.cSymbol,
      root_c_symbol: candidate.root.cSymbol,
      root_type: candidate.root.type,
    })
  }
  return instances.sort((left, right) => left.id - right.id)
}

export const bindIecDebugVariablesToInstances = (
  variables: IecDebugVariable[],
  instances: IecDebugInstance[],
): IecDebugVariable[] =>
  variables.map((variable) => {
    const instance = instances
      .filter(
        (candidate) => variable.name === candidate.source_path || variable.name.startsWith(`${candidate.source_path}.`),
      )
      .sort((left, right) => right.source_path.length - left.source_path.length)[0]
    const relativePath = instance ? variable.name.slice(instance.source_path.length).replace(/^\./, '') : variable.name
    return {
      ...variable,
      instance_id: instance?.id ?? 0,
      path: instance && relativePath ? `${instance.path}.${toIecDisplayPath(relativePath)}` : variable.name,
    }
  })

const getGraphicalNodeData = (node: GraphicalNode): GraphicalNodeData =>
  typeof node.data === 'object' && node.data !== null ? (node.data as GraphicalNodeData) : {}

const pickBreakpointStatement = (statements: IecDebugMetadata['statements']): number =>
  (statements.find((statement) => /call/i.test(statement.type)) ?? statements[0])?.id ?? 0

const sortGraphicalNodes = (nodes: GraphicalNode[]): GraphicalNode[] =>
  [...nodes].sort(
    (left, right) =>
      (left.position?.y ?? 0) - (right.position?.y ?? 0) ||
      (left.position?.x ?? 0) - (right.position?.x ?? 0) ||
      left.id.localeCompare(right.id),
  )

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const parseXml2stSourceMap = (sourceMapJson: string, projectXml: string, programSt: string): Xml2stSourceMap => {
  const sourceMap = JSON.parse(sourceMapJson) as Xml2stSourceMap
  if (sourceMap.format !== 'eurosonic-xml2st-source-map' || sourceMap.version !== 1) {
    throw new Error('Unsupported xml2st source-map format')
  }
  if (!Number.isInteger(sourceMap.st_length) || sourceMap.st_length < 0 || sourceMap.st_length > programSt.length) {
    throw new Error('Invalid xml2st source-map ST length')
  }
  const compiledProgramSt = programSt.slice(0, sourceMap.st_length)
  if (sourceMap.project_sha256 !== sha256(projectXml)) throw new Error('xml2st source-map project hash mismatch')
  if (sourceMap.st_sha256 !== sha256(compiledProgramSt)) throw new Error('xml2st source-map ST hash mismatch')
  for (const chunk of sourceMap.chunks) {
    if (chunk.quality !== 'exact' || !chunk.span) continue
    const sourceText = compiledProgramSt.slice(chunk.span.start.offset, chunk.span.end.offset)
    if (sourceText !== chunk.text) throw new Error('xml2st source-map span does not match final ST text')
  }
  return sourceMap
}

const statementOverlapsSpan = (
  statement: IecDebugMetadata['statements'][number],
  span: IecDebugSourceSpan,
): boolean => {
  if (statement.end_line < span.start.line || statement.line > span.end.line) return false
  if (statement.line === span.end.line && statement.column >= span.end.column) return false
  if (statement.end_line === span.start.line && statement.end_column <= span.start.column) return false
  return true
}

const getPinBinding = (chunk: Xml2stSourceMapChunk, node: GraphicalNode): IecGraphicalPinBinding | undefined => {
  if (!chunk.span || !chunk.graphical || chunk.graphical.kind !== 'block') return undefined
  const [direction, rawIndex] = chunk.graphical.path
  if (direction !== 'input' && direction !== 'output' && direction !== 'inout') return undefined
  const pinIndex = typeof rawIndex === 'number' ? rawIndex : undefined
  const variables = getGraphicalNodeData(node).variant?.variables ?? []
  const variablesForDirection = variables.filter((variable) => {
    const variableClass = variable.class
    if (direction === 'input') return variableClass === 'input' || variableClass === 'inOut'
    if (direction === 'output') return variableClass === 'output' || variableClass === 'inOut'
    return variableClass === 'inOut'
  })
  const formalParameter =
    (pinIndex === undefined ? undefined : variablesForDirection[pinIndex]?.name) ||
    (direction === 'input' ? chunk.text.trim() : undefined)
  return {
    direction,
    ...(formalParameter ? { formal_parameter: formalParameter } : {}),
    ...(pinIndex !== undefined ? { pin_index: pinIndex } : {}),
    source_spans: [chunk.span],
  }
}

const sourceSpanKey = (span: IecDebugSourceSpan): string => `${span.start.offset}:${span.end.offset}`

const mergePinBindings = (chunks: Xml2stSourceMapChunk[], node: GraphicalNode): IecGraphicalPinBinding[] => {
  const pins = new Map<string, IecGraphicalPinBinding>()
  for (const chunk of chunks) {
    const pin = getPinBinding(chunk, node)
    if (!pin) continue
    const key = `${pin.direction}:${pin.formal_parameter ?? ''}:${pin.pin_index ?? ''}`
    const current = pins.get(key)
    if (!current) {
      pins.set(key, pin)
      continue
    }
    const knownSpans = new Set(current.source_spans.map(sourceSpanKey))
    for (const span of pin.source_spans) {
      if (!knownSpans.has(sourceSpanKey(span))) current.source_spans.push(span)
    }
  }
  return [...pins.values()]
}

const createGraphicalBinding = (
  pouId: number,
  language: 'fbd' | 'ld',
  node: GraphicalNode,
  kind: IecGraphicalDebugBinding['kind'],
  sourceChunks: Xml2stSourceMapChunk[],
  statements: IecDebugMetadata['statements'],
  rungId?: string,
): IecGraphicalDebugBinding | undefined => {
  const sourceSpans = sourceChunks
    .flatMap((chunk) => (chunk.span ? [chunk.span] : []))
    .filter(
      (span, index, spans) =>
        spans.findIndex((candidate) => sourceSpanKey(candidate) === sourceSpanKey(span)) === index,
    )
  const matchingStatements = statements
    .filter((statement) => sourceSpans.some((span) => statementOverlapsSpan(statement, span)))
    .sort((left, right) => left.line - right.line || left.column - right.column || left.id - right.id)
  const breakpointStatementId = pickBreakpointStatement(matchingStatements)
  if (breakpointStatementId === 0) return undefined
  const pins = mergePinBindings(sourceChunks, node)
  return {
    pou_id: pouId,
    language,
    node_id: node.id,
    local_id: getGraphicalNodeData(node).numericId ?? node.id,
    ...(rungId ? { rung_id: rungId } : {}),
    kind,
    statement_ids: matchingStatements.map((statement) => statement.id),
    breakpoint_statement_id: breakpointStatementId,
    source_line: Math.min(...sourceSpans.map((span) => span.start.line)),
    source_spans: sourceSpans,
    pins,
  }
}

/**
 * Joins PC-side LD/FBD node IDs to the stable statement IDs emitted by the
 * instrumented MatIEC build. The result is editor metadata only; it does not
 * add protocol data or code to the target runtime.
 */
export const buildGraphicalDebugBindings = (
  projectData: ProjectState['data'],
  metadata: Pick<IecDebugMetadata, 'pous' | 'statements'>,
  sourceMap: Xml2stSourceMap,
): IecGraphicalDebugBinding[] => {
  const bindings: IecGraphicalDebugBinding[] = []

  for (const pou of projectData.pous) {
    const language = pou.data.body.language
    if (language !== 'fbd' && language !== 'ld') continue
    const metadataPou = metadata.pous.find((candidate) => candidate.name.toUpperCase() === pou.data.name.toUpperCase())
    if (!metadataPou) continue
    const statements = metadata.statements.filter((statement) => statement.pou_id === metadataPou.id)

    const bindNode = (
      node: GraphicalNode,
      kind: IecGraphicalDebugBinding['kind'],
      sourceKind: string,
      rungId?: string,
    ) => {
      const localId = Number(getGraphicalNodeData(node).numericId)
      if (!Number.isSafeInteger(localId)) return
      const sourceChunks = sourceMap.chunks.filter(
        (chunk) =>
          chunk.quality === 'exact' &&
          chunk.span !== undefined &&
          chunk.graphical?.pou.toUpperCase() === pou.data.name.toUpperCase() &&
          chunk.graphical.kind === sourceKind &&
          chunk.graphical.local_id === localId,
      )
      const binding = createGraphicalBinding(metadataPou.id, language, node, kind, sourceChunks, statements, rungId)
      if (!binding) return
      bindings.push(binding)
    }

    if (language === 'fbd') {
      const nodes = sortGraphicalNodes(pou.data.body.value.rung.nodes as GraphicalNode[])
      for (const node of nodes) {
        if (node.type === 'block') {
          bindNode(node, 'block', 'block')
          continue
        }
        if (node.type !== 'output-variable' && node.type !== 'inout-variable') continue
        bindNode(node, 'output-variable', 'io_variable')
      }
      continue
    }

    for (const rung of pou.data.body.value.rungs) {
      const nodes = sortGraphicalNodes(rung.nodes as GraphicalNode[])
      for (const node of nodes) {
        if (node.type === 'block') {
          bindNode(node, 'block', 'block', rung.id)
          continue
        }
        if (node.type !== 'coil') continue
        bindNode(node, 'coil', 'coil', rung.id)
      }
    }
  }

  return bindings
}

export const enrichIecDebugMetadata = (
  metadataJson: string,
  variables: IecDebugVariable[],
  instances: IecDebugInstance[] = [],
  graphicalBindings: IecGraphicalDebugBinding[] = [],
  sourceIdentity?: IecDebugSourceIdentity,
): string => {
  const metadata = JSON.parse(metadataJson) as IecDebugMetadata
  if (metadata.format !== 'eurosonic-plc-debug' || metadata.version !== 1 || metadata.id_algorithm !== 'fnv1a32') {
    throw new Error('Unsupported IEC debug metadata format')
  }

  const ids = new Map<number, string>()
  for (const record of [...metadata.pous, ...metadata.statements, ...variables, ...instances]) {
    const existing = ids.get(record.id)
    if (existing && existing !== record.key) {
      throw new Error(
        `IEC debug ID collision 0x${record.id.toString(16).padStart(8, '0')} between '${existing}' and '${record.key}'`,
      )
    }
    ids.set(record.id, record.key)
  }

  metadata.variables = variables
  metadata.instances = instances.map(({ c_expression, root_c_symbol, root_type, ...instance }) => instance)
  metadata.graphical_bindings = graphicalBindings
  metadata.source_identity = sourceIdentity
  metadata.build_id = fnv1a64([
    ...[...ids.entries()].sort(([left], [right]) => left - right).map(([, key]) => key),
    ...(sourceIdentity ? Object.values(sourceIdentity).map(String) : []),
  ])
  return `${JSON.stringify(metadata, null, 2)}\n`
}

export const renderIecDebugVariableAdapter = (
  variables: IecDebugVariable[],
  instances: IecDebugInstance[] = [],
): string => {
  const descriptors = variables
    .map(
      (variable) =>
        `    { UINT32_C(${variable.id}), UINT16_C(${variable.type_code}), UINT16_C(${variable.legacy_index}), ${variable.writable ? '1' : '0'} },`,
    )
    .join('\n')
  const roots = Array.from(new Map(instances.map((instance) => [instance.root_c_symbol, instance])).values())
    .map((instance) => `extern ${instance.root_type} ${instance.root_c_symbol};`)
    .join('\n')
  const instanceDescriptors = instances
    .map(
      (instance) =>
        `    { UINT32_C(${instance.id}), UINT32_C(${instance.pou_id}), (uintptr_t)&(${instance.c_expression}) },`,
    )
    .join('\n')

  return `
// ${IEC_DEBUG_VARIABLE_ADAPTER_MARKER}
#include "plc_debug_runtime.h"
#include <string.h>

${roots}

typedef struct
{
    uint32_t id;
    uint16_t type;
    uint16_t legacy_index;
    uint8_t writable;
} plc_debug_variable_descriptor_t;

static const plc_debug_variable_descriptor_t plc_debug_variables[] = {
${descriptors}
};

typedef struct
{
    uint32_t id;
    uint32_t pou_id;
    uintptr_t address;
} plc_debug_instance_descriptor_t;

static const plc_debug_instance_descriptor_t plc_debug_instances[] = {
${instanceDescriptors}
};

#define PLC_DEBUG_INSTANCE_COUNT (sizeof(plc_debug_instances) / sizeof(plc_debug_instances[0]))

uint32_t plc_debug_instance_resolve(uint32_t pou_id, uintptr_t address)
{
    size_t index;
    for (index = 0; index < PLC_DEBUG_INSTANCE_COUNT; index++)
    {
        if ((plc_debug_instances[index].pou_id == pou_id) && (plc_debug_instances[index].address == address))
            return plc_debug_instances[index].id;
    }
    return PLC_DEBUG_INSTANCE_NONE;
}

#define PLC_DEBUG_VARIABLE_COUNT (sizeof(plc_debug_variables) / sizeof(plc_debug_variables[0]))

static const plc_debug_variable_descriptor_t *plc_debug_find_variable(uint32_t id)
{
    size_t low = 0;
    size_t high = PLC_DEBUG_VARIABLE_COUNT;
    while (low < high)
    {
        const size_t middle = low + ((high - low) / 2);
        if (plc_debug_variables[middle].id == id) return &plc_debug_variables[middle];
        if (plc_debug_variables[middle].id < id) low = middle + 1;
        else high = middle;
    }
    return 0;
}

#define PLC_DEBUG_FORCED_VALUE_CASE(TYPENAME) \\
    case TYPENAME##_ENUM: return (((__IEC_##TYPENAME##_t *)ptr)->flags & __IEC_FORCE_FLAG) != 0;
#define PLC_DEBUG_FORCED_POINTER_CASE(TYPENAME) \\
    case TYPENAME##_P_ENUM: \\
    case TYPENAME##_O_ENUM: return (((__IEC_##TYPENAME##_p *)ptr)->flags & __IEC_FORCE_FLAG) != 0;

static uint8_t plc_debug_legacy_is_forced(size_t index)
{
    void *ptr;
    if (index >= VAR_COUNT) return 0;
    ptr = debug_vars[index].ptr;
    switch (debug_vars[index].type)
    {
        __ANY(PLC_DEBUG_FORCED_VALUE_CASE)
        __ANY(PLC_DEBUG_FORCED_POINTER_CASE)
        default: return 0;
    }
}

#undef PLC_DEBUG_FORCED_VALUE_CASE
#undef PLC_DEBUG_FORCED_POINTER_CASE

plc_debug_result_t plc_debug_variable_read(uint32_t id, uint16_t expected_type, void *value,
                                           uint16_t capacity, uint16_t *actual_size, uint8_t *forced)
{
    const plc_debug_variable_descriptor_t *descriptor = plc_debug_find_variable(id);
    size_t size;
    void *address;
    if (descriptor == 0) return PLC_DEBUG_RESULT_NOT_FOUND;
    if ((expected_type != PLC_DEBUG_VARIABLE_UNKNOWN) && (expected_type != descriptor->type))
        return PLC_DEBUG_RESULT_TYPE_MISMATCH;
    size = get_var_size(descriptor->legacy_index);
    if ((size == 0) || (size > UINT16_MAX)) return PLC_DEBUG_RESULT_UNSUPPORTED;
    if (actual_size != 0) *actual_size = (uint16_t)size;
    if ((value == 0) || (capacity < size)) return PLC_DEBUG_RESULT_SIZE_MISMATCH;
    address = get_var_addr(descriptor->legacy_index);
    if (address == 0) return PLC_DEBUG_RESULT_UNSUPPORTED;
    memcpy(value, address, size);
    if (forced != 0) *forced = plc_debug_legacy_is_forced(descriptor->legacy_index);
    return PLC_DEBUG_RESULT_OK;
}

plc_debug_result_t plc_debug_variable_write(uint32_t id, uint16_t expected_type,
                                            const void *value, uint16_t size)
{
    const plc_debug_variable_descriptor_t *descriptor = plc_debug_find_variable(id);
    void *address;
    if (descriptor == 0) return PLC_DEBUG_RESULT_NOT_FOUND;
    if (!descriptor->writable) return PLC_DEBUG_RESULT_READ_ONLY;
    if ((expected_type != PLC_DEBUG_VARIABLE_UNKNOWN) && (expected_type != descriptor->type))
        return PLC_DEBUG_RESULT_TYPE_MISMATCH;
    if (get_var_size(descriptor->legacy_index) != size) return PLC_DEBUG_RESULT_SIZE_MISMATCH;
    if (plc_debug_legacy_is_forced(descriptor->legacy_index)) return PLC_DEBUG_RESULT_FORCED;
    if (value == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    address = get_var_addr(descriptor->legacy_index);
    if (address == 0) return PLC_DEBUG_RESULT_UNSUPPORTED;
    memcpy(address, value, size);
    return PLC_DEBUG_RESULT_OK;
}

plc_debug_result_t plc_debug_variable_force(uint32_t id, uint16_t expected_type,
                                            const void *value, uint16_t size)
{
    const plc_debug_variable_descriptor_t *descriptor = plc_debug_find_variable(id);
    if (descriptor == 0) return PLC_DEBUG_RESULT_NOT_FOUND;
    if (!descriptor->writable) return PLC_DEBUG_RESULT_READ_ONLY;
    if ((expected_type != PLC_DEBUG_VARIABLE_UNKNOWN) && (expected_type != descriptor->type))
        return PLC_DEBUG_RESULT_TYPE_MISMATCH;
    if (get_var_size(descriptor->legacy_index) != size) return PLC_DEBUG_RESULT_SIZE_MISMATCH;
    if (value == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    force_var(descriptor->legacy_index, true, (void *)value);
    return PLC_DEBUG_RESULT_OK;
}

plc_debug_result_t plc_debug_variable_unforce(uint32_t id)
{
    const plc_debug_variable_descriptor_t *descriptor = plc_debug_find_variable(id);
    if (descriptor == 0) return PLC_DEBUG_RESULT_NOT_FOUND;
    force_var(descriptor->legacy_index, false, 0);
    return PLC_DEBUG_RESULT_OK;
}
`
}
