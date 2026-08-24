import { resolveImplicitVariableMatch } from './implicit-submit'

describe('graphical editor implicit variable submission', () => {
  const variables = [
    { id: 'value-a', name: 'ValueA' },
    { id: 'result', name: 'Result' },
  ]

  it('binds an exact existing variable without requiring arrow selection', () => {
    expect(resolveImplicitVariableMatch(variables, ' valuea ')).toEqual({ id: 'value-a', name: 'ValueA' })
    expect(resolveImplicitVariableMatch(variables, 'RESULT')).toEqual({ id: 'result', name: 'Result' })
  })

  it('leaves non-matching or empty input to the existing add-variable fallback', () => {
    expect(resolveImplicitVariableMatch(variables, 'Value')).toBeUndefined()
    expect(resolveImplicitVariableMatch(variables, '')).toBeUndefined()
    expect(resolveImplicitVariableMatch(undefined, 'ValueA')).toBeUndefined()
  })
})
