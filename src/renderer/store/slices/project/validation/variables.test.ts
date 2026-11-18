import type { PLCVariable } from '@root/types/PLC/open-plc'

import {
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from './variables'

const variable = (name: string, type: string, location: string): PLCVariable =>
  ({
    name,
    location,
    type: { definition: 'base-type', value: type },
  }) as PLCVariable

describe('project variable location allocation', () => {
  it('walks past consecutive claimed BOOL locations', () => {
    const existing = [
      variable('B0', 'BOOL', '%IX0.0'),
      variable('B1', 'BOOL', '%IX0.1'),
      variable('B2', 'BOOL', '%IX0.2'),
      variable('B3', 'BOOL', '%IX0.3'),
      variable('B4', 'BOOL', '%IX0.4'),
      variable('B5', 'BOOL', '%IX0.5'),
    ]
    expect(createVariableValidation(existing, variable('NewBool', 'BOOL', '%IX0.4')).location).toBe('%IX0.6')
  })

  it('walks past consecutive claimed WORD locations', () => {
    const existing = [variable('A', 'INT', '%QW5'), variable('B', 'INT', '%QW6'), variable('C', 'INT', '%QW7')]
    expect(createVariableValidation(existing, variable('NewWord', 'INT', '%QW5')).location).toBe('%QW8')
  })

  it('wraps a full BOOL byte and continues to the next free bit', () => {
    const existing = Array.from({ length: 8 }, (_, bit) => variable(`B${bit}`, 'BOOL', `%QX0.${bit}`))
    existing.push(variable('B8', 'BOOL', '%QX1.0'))
    expect(createVariableValidation(existing, variable('NewBool', 'BOOL', '%QX0.0')).location).toBe('%QX1.1')
  })
})

describe('case-insensitive variable names', () => {
  it('allows changing only the casing of the current variable', () => {
    const motor = variable('Motor', 'BOOL', '')
    expect(updateVariableValidation([motor], { name: 'motor' }, motor).ok).toBe(true)
    expect(updateGlobalVariableValidation([motor], { name: 'motor' }, motor).ok).toBe(true)
  })

  it('rejects a case-insensitive collision with another variable', () => {
    const motor = variable('Motor', 'BOOL', '')
    const other = variable('Other', 'BOOL', '')
    expect(updateVariableValidation([motor, other], { name: 'MOTOR' }, other).ok).toBe(false)
    expect(updateGlobalVariableValidation([motor, other], { name: 'MOTOR' }, other).ok).toBe(false)
  })

  it('does not allocate a global name that differs only in case', () => {
    const name = createGlobalVariableValidation([variable('Motor', 'BOOL', '')], 'motor')
    expect(name.toLowerCase()).not.toBe('motor')
  })
})
