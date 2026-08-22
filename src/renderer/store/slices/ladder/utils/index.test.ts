import { normalizeConnectedVariables } from './normalize-connected-variables'

describe('normalizeConnectedVariables', () => {
  it('keeps the current array representation', () => {
    const current = [{ handleId: 'Q', type: 'output' as const, variable: undefined }]
    expect(normalizeConnectedVariables(current)).toBe(current)
  })

  it('converts the legacy object representation', () => {
    expect(
      normalizeConnectedVariables({
        IN: { type: 'input', variable: undefined },
        Q: { type: 'output', variable: undefined },
      }),
    ).toEqual([
      { handleId: 'IN', type: 'input', variable: undefined },
      { handleId: 'Q', type: 'output', variable: undefined },
    ])
  })

  it('uses an empty list for malformed values', () => {
    expect(normalizeConnectedVariables(undefined)).toEqual([])
    expect(normalizeConnectedVariables('invalid')).toEqual([])
  })
})
