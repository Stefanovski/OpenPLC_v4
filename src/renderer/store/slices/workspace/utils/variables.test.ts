import type { PLCVariable } from '@root/types/PLC/open-plc'

import { createGlobalVariableValidation, createVariableValidation, updateVariableValidation } from './variables'

const variable = (name: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: 'bool' },
  location: '',
  initialValue: null,
  documentation: '',
  debug: false,
})

it('allocates unique names across case variants in workspace lists', () => {
  const existing = [variable('Motor'), variable('MOTOR_1'), variable('motor_2')]
  for (const allocate of [createVariableValidation, createGlobalVariableValidation]) {
    const name = allocate(existing, 'motor')
    expect(existing.some((item) => item.name.toLowerCase() === name.toLowerCase())).toBe(false)
  }
})

it('permits a case-only rename but rejects a different variable with that name', () => {
  const motor = variable('Motor')
  const other = variable('Other')
  expect(updateVariableValidation([motor, other], { name: 'motor' }, motor).ok).toBe(true)
  expect(updateVariableValidation([motor, other], { name: 'motor' }, other).ok).toBe(false)
})
