import type { PLCVariable } from '@root/types/PLC/open-plc'
import {
  generateStructMember,
  getArrayBaseTypeValue,
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
  mapBaseTypeToIEC,
} from '@root/utils/PLC/array-codegen-helpers'

import { generateCBlocksCode } from './generateCBlocksCode'
import { generateCBlocksHeader } from './generateCBlocksHeader'
import { generateSTCode } from './generateSTCode'

const scalar = (name: string, variableClass: PLCVariable['class'] = 'input'): PLCVariable => ({
  name,
  class: variableClass,
  type: { definition: 'base-type', value: 'int' },
  location: '',
  documentation: '',
})

const array = (name: string, dimension: string, variableClass: PLCVariable['class'] = 'input'): PLCVariable => ({
  name,
  class: variableClass,
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF INT`,
    data: { baseType: { definition: 'base-type', value: 'int' }, dimensions: [{ dimension }] },
  },
  location: '',
  documentation: '',
})

describe('C++ array code generation', () => {
  it('describes scalar and array IEC types and dimensions', () => {
    const samples = array('samples', '-2..0')
    const invalid = array('invalid', 'broken')
    const derived = {
      ...scalar('custom'),
      type: { definition: 'derived', value: 'MY_FB' },
    } as PLCVariable

    expect(isArrayVariable(samples)).toBe(true)
    expect(isArrayVariable(scalar('value'))).toBe(false)
    expect(getArrayTotalElements(samples)).toBe(3)
    expect(getArrayTotalElements(invalid)).toBe(0)
    expect(getArrayTotalElements(scalar('value'))).toBe(0)
    expect(getArrayStartIndex(samples)).toBe(-2)
    expect(getArrayStartIndex(invalid)).toBe(0)
    expect(getArrayStartIndex(scalar('value'))).toBe(0)
    expect(getArrayBaseTypeValue(samples)).toBe('int')
    expect(getArrayBaseTypeValue(scalar('value'))).toBe('')
    expect(mapBaseTypeToIEC('INT')).toBe('IEC_INT')
    expect(mapBaseTypeToIEC('custom')).toBe('CUSTOM')
    expect(getVariableIECType(samples)).toBe('IEC_INT')
    expect(getVariableIECType(scalar('value'))).toBe('IEC_INT')
    expect(getVariableIECType(derived)).toBe('MY_FB')
    expect(generateStructMember(samples)).toBe('  IEC_INT *SAMPLES;\n')
  })

  it('exposes arrays as indexed pointers in generated C++ wrappers', () => {
    const variables = [scalar('setpoint'), array('samples', '1..3', 'output')]
    const code = generateCBlocksCode([{ name: 'controller', code: 'void setup() {}\nvoid loop() {}', variables }])
    const header = generateCBlocksHeader([{ name: 'controller', variables }])

    expect(code).toContain('#define setpoint (*(vars->SETPOINT))')
    expect(code).toContain('#define samples (vars->SAMPLES)')
    expect(code).toContain('void controller_setup(CONTROLLER_VARS *vars)')
    expect(header).toContain('IEC_INT *SAMPLES;')
  })

  it('copies wrapped MatIEC array elements through a flat buffer', () => {
    const code = generateSTCode({
      pouName: 'controller',
      allVariables: [array('samples', '-2..0'), array('result', '1..3', 'output'), scalar('enabled')],
    })

    expect(code).toContain('IEC_INT __flat_SAMPLES[3];')
    expect(code).toContain('__flat_SAMPLES[__i] = data__->SAMPLES.value.table[__i].value;')
    expect(code).toContain('vars.SAMPLES = __flat_SAMPLES - -2;')
    expect(code).toContain('vars.ENABLED = &data__->ENABLED.value;')
    expect(code).toContain('data__->RESULT.value.table[__i].value = __flat_RESULT[__i];')
  })
})
