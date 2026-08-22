import { PLCVariable } from '@root/types/PLC/open-plc'

import { parseDimensionRange } from './array-variable-utils'

const BASE_TYPE_TO_IEC: Record<string, string> = {
  bool: 'IEC_BOOL',
  sint: 'IEC_SINT',
  int: 'IEC_INT',
  dint: 'IEC_DINT',
  lint: 'IEC_LINT',
  usint: 'IEC_USINT',
  uint: 'IEC_UINT',
  udint: 'IEC_UDINT',
  ulint: 'IEC_ULINT',
  byte: 'IEC_BYTE',
  word: 'IEC_WORD',
  dword: 'IEC_DWORD',
  lword: 'IEC_LWORD',
  real: 'IEC_REAL',
  lreal: 'IEC_LREAL',
  string: 'IEC_STRING',
}

const isArrayVariable = (variable: PLCVariable): boolean => variable.type.definition === 'array'

const getArrayTotalElements = (variable: PLCVariable): number => {
  if (variable.type.definition !== 'array') return 0

  return variable.type.data.dimensions.reduce((total, dimension) => {
    const range = parseDimensionRange(dimension.dimension)
    return range ? total * (range.upper - range.lower + 1) : 0
  }, 1)
}

const getArrayBaseTypeValue = (variable: PLCVariable): string =>
  variable.type.definition === 'array' ? variable.type.data.baseType.value : ''

const mapBaseTypeToIEC = (baseType: string): string =>
  BASE_TYPE_TO_IEC[baseType.toLowerCase()] || baseType.toUpperCase()

const getVariableIECType = (variable: PLCVariable): string => {
  if (variable.type.definition === 'array') return mapBaseTypeToIEC(variable.type.data.baseType.value)
  if (variable.type.definition === 'base-type') return mapBaseTypeToIEC(variable.type.value)
  return variable.type.value.toUpperCase()
}

const getArrayStartIndex = (variable: PLCVariable): number => {
  if (variable.type.definition !== 'array') return 0
  const range = parseDimensionRange(variable.type.data.dimensions[0]?.dimension ?? '')
  return range?.lower ?? 0
}

const generateStructMember = (variable: PLCVariable): string => {
  return `  ${getVariableIECType(variable)} *${variable.name.toUpperCase()};\n`
}

export {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  mapBaseTypeToIEC,
}
