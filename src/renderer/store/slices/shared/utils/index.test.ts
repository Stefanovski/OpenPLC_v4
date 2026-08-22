import { CreateDatatypeObject } from '.'

describe('CreateDatatypeObject', () => {
  it('does not seed a new array with a BOOL-specific initial value', () => {
    const result = CreateDatatypeObject({ name: 'values', derivation: 'array' })

    expect(result.derivation).toBe('array')
    if (result.derivation === 'array') expect(result.initialValue).toBe('')
  })
})
