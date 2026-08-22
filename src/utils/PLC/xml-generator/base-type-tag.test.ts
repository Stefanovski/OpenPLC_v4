import { baseTypeTag } from './base-type-tag'

describe('baseTypeTag', () => {
  it('uses lowercase PLCopen tags for character strings', () => {
    expect(baseTypeTag('STRING')).toBe('string')
    expect(baseTypeTag('WString')).toBe('wstring')
  })

  it('uses uppercase PLCopen tags for all other base types', () => {
    expect(baseTypeTag(' int ')).toBe('INT')
    expect(baseTypeTag('Real')).toBe('REAL')
  })
})
