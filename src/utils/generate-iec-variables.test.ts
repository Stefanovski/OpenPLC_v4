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
