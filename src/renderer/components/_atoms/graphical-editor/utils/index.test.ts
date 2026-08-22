import { getVariableRestrictionType, validateVariableType } from '.'

describe('graphical editor variable type validation', () => {
  it('resolves nested ANY_ELEMENTARY types without throwing', () => {
    expect(validateVariableType('REAL', 'ANY_ELEMENTARY')).toEqual({ isValid: true, error: undefined })
    expect(validateVariableType('BOOL', 'ANY_ELEMENTARY')).toEqual({ isValid: true, error: undefined })
  })

  it('resolves nested ANY_INTEGRAL types', () => {
    expect(validateVariableType('INT', 'ANY_INTEGRAL').isValid).toBe(true)
    expect(validateVariableType('WORD', 'ANY_INTEGRAL').isValid).toBe(true)
    expect(validateVariableType('REAL', 'ANY_INTEGRAL').isValid).toBe(false)
  })

  it('returns concrete restrictions for nested generics', () => {
    const restriction = getVariableRestrictionType('ANY_MAGNITUDE')

    expect(restriction.definition).toBe('base-type')
    expect(restriction.values).toEqual(expect.arrayContaining(['real', 'lreal', 'int', 'dint', 'time']))
  })
})
