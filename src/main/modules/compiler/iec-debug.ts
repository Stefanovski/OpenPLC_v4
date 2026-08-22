import type { ProjectState } from '@root/renderer/store/slices'

export const IEC_DEBUG_METADATA_FILE = 'program.debug.json'
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
  instances: unknown[]
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
    })
    legacyIndex += 1
  }

  return variables.sort((left, right) => left.id - right.id)
}

export const enrichIecDebugMetadata = (metadataJson: string, variables: IecDebugVariable[]): string => {
  const metadata = JSON.parse(metadataJson) as IecDebugMetadata
  if (metadata.format !== 'eurosonic-plc-debug' || metadata.version !== 1 || metadata.id_algorithm !== 'fnv1a32') {
    throw new Error('Unsupported IEC debug metadata format')
  }

  const ids = new Map<number, string>()
  for (const record of [...metadata.pous, ...metadata.statements, ...variables]) {
    const existing = ids.get(record.id)
    if (existing && existing !== record.key) {
      throw new Error(
        `IEC debug ID collision 0x${record.id.toString(16).padStart(8, '0')} between '${existing}' and '${record.key}'`,
      )
    }
    ids.set(record.id, record.key)
  }

  metadata.variables = variables
  metadata.build_id = fnv1a64([...ids.entries()].sort(([left], [right]) => left - right).map(([, key]) => key))
  return `${JSON.stringify(metadata, null, 2)}\n`
}

export const renderIecDebugVariableAdapter = (variables: IecDebugVariable[]): string => {
  const descriptors = variables
    .map(
      (variable) =>
        `    { UINT32_C(${variable.id}), UINT16_C(${variable.type_code}), UINT16_C(${variable.legacy_index}), ${variable.writable ? '1' : '0'} },`,
    )
    .join('\n')

  return `
// ${IEC_DEBUG_VARIABLE_ADAPTER_MARKER}
#include "plc_debug_runtime.h"
#include <string.h>

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
