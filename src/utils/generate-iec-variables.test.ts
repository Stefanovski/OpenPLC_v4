import { PLCVariable } from '@root/types/PLC'

import { parseIecStringToVariables } from './generate-iec-string-to-variables'
import { generateIecVariablesToString } from './generate-iec-variables-to-string'

const expectedParsedVariable = {
  name: 'aoutch0',
  class: 'local',
  type: { definition: 'base-type', value: 'int' },
  location: '%QW1200',
  initialValue: null,
  documentation: '',
  debug: false,
}

const locatedVariable: PLCVariable = {
  ...expectedParsedVariable,
  class: 'local',
  type: { definition: 'base-type', value: 'INT' },
}

describe('IEC variable text compatibility', () => {
  it('parses the existing Eurosonic AT-before-type syntax', () => {
    const result = parseIecStringToVariables('VAR\n\taoutch0 AT %QW1200 : int;\nEND_VAR')

    expect(result).toEqual([expectedParsedVariable])
  })

  it('also parses the transitional v4.1.0 type-before-AT syntax', () => {
    const result = parseIecStringToVariables('VAR\n\taoutch0 : int AT %QW1200;\nEND_VAR')

    expect(result).toEqual([expectedParsedVariable])
  })

  it('continues to serialize the established Eurosonic syntax', () => {
    expect(generateIecVariablesToString([locatedVariable])).toBe('VAR\n\taoutch0 AT %QW1200 : INT;\nEND_VAR')
  })
})

describe('v4.3 variable text backports', () => {
  it('round-trips multi-dimensional arrays including negative bounds and initial values', () => {
    const variables = parseIecStringToVariables('VAR\nSamples : ARRAY[-1..1, 2..3] OF INT := [1,2,3,4,5,6];\nEND_VAR')
    expect(variables[0].type).toMatchObject({
      definition: 'array',
      data: {
        baseType: { definition: 'base-type', value: 'int' },
        dimensions: [{ dimension: '-1..1' }, { dimension: '2..3' }],
      },
    })
    expect(parseIecStringToVariables(generateIecVariablesToString(variables))).toEqual(variables)
  })

  it('serializes table-created arrays from their dimensions, not their display label', () => {
    const variables = parseIecStringToVariables('VAR\na : ARRAY[0..2] OF INT;\nEND_VAR')
    variables[0].type.value = 'array'
    expect(generateIecVariablesToString(variables)).toContain('ARRAY [0..2] OF INT')
  })

  it('keeps symbolic bounds and user-defined element types', () => {
    const result = parseIecStringToVariables('VAR\na : ARRAY[0..MAX, 1..2] OF MyType;\nEND_VAR')
    expect(result[0].type).toMatchObject({
      definition: 'array',
      data: { baseType: { definition: 'user-data-type', value: 'MyType' } },
    })
  })

  it.each(['ARRAY[0..1,] OF INT', 'ARRAY[,0..1] OF INT', 'ARRAY[0..1,,2..3] OF INT', 'ARRAY[] OF INT', 'INT, DINT'])(
    'rejects malformed type %s',
    (type) => {
      expect(() => parseIecStringToVariables(`VAR\na : ${type};\nEND_VAR`)).toThrow(/Invalid ARRAY/)
    },
  )

  it.each(['a AT %MW10 : ARRAY[0..1,] OF INT;', 'a : ARRAY[0..1,] OF INT AT %MW10;'])(
    'checks malformed arrays in both location formats',
    (declaration) => {
      expect(() => parseIecStringToVariables(`VAR\n${declaration}\nEND_VAR`)).toThrow(/Invalid ARRAY/)
    },
  )

  it('rejects case-insensitive duplicate names across declaration sections', () => {
    expect(() => parseIecStringToVariables('VAR_INPUT\nMotor : BOOL;\nEND_VAR\nVAR\nmotor : BOOL;\nEND_VAR')).toThrow(
      /declared more than once/,
    )
  })

  it('retains ordinary comma-containing string initializers', () => {
    expect(parseIecStringToVariables("VAR\ns : STRING := 'a,b';\nEND_VAR")[0].initialValue).toBe("'a,b'")
  })
})
