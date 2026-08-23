import {
  collectGraphicalDebugWatchKeys,
  getGraphicalDebugSample,
  GRAPHICAL_DEBUG_STALE_AFTER_MS,
  parseGraphicalDebugBoolean,
} from './graphical-debug'

describe('graphical debugger', () => {
  const availableKeys = new Set([
    'main:Input',
    'main:Output',
    'main:Counter.Value',
    'main:Counter.Done',
    'main:_TMP_EQ42_OUT',
    'main:_TMP_EQ42_ENO',
  ])
  const makeCompositeKey = (name: string) => `main:${name}`

  it('collects only visible variable and block output keys that exist in the debug registry', () => {
    const keys = collectGraphicalDebugWatchKeys({
      availableKeys,
      makeCompositeKey,
      nodes: [
        { type: 'contact', data: { variable: { name: 'Input' } } },
        { type: 'coil', data: { variable: { name: 'Output' } } },
        { type: 'variable', data: { variable: { name: 'Missing' } } },
        {
          type: 'block',
          data: {
            variable: { name: 'Counter' },
            variant: {
              type: 'function-block',
              variables: [
                { name: 'Enable', class: 'input' },
                { name: 'Value', class: 'output' },
                { name: 'Done', class: 'inOut' },
                { name: 'Internal', class: 'local' },
              ],
            },
          },
        },
      ],
    })

    expect([...keys].sort()).toEqual(['main:Counter.Done', 'main:Counter.Value', 'main:Input', 'main:Output'].sort())
  })

  it('collects function outputs and an implicit ENO for execution control', () => {
    const keys = collectGraphicalDebugWatchKeys({
      availableKeys,
      makeCompositeKey,
      nodes: [
        {
          type: 'block',
          data: {
            numericId: '42',
            executionControl: true,
            variant: {
              name: 'EQ',
              type: 'function',
              variables: [
                { name: 'IN1', class: 'input' },
                { name: 'OUT', class: 'output' },
              ],
            },
          },
        },
      ],
    })

    expect([...keys].sort()).toEqual(['main:_TMP_EQ42_ENO', 'main:_TMP_EQ42_OUT'])
  })

  it('ignores incomplete nodes and an unresolved POU context', () => {
    const keys = collectGraphicalDebugWatchKeys({
      availableKeys,
      makeCompositeKey: () => null,
      nodes: [
        { type: 'contact', data: {} },
        { type: 'block', data: { variant: { type: 'function-block', variables: [] } } },
        { type: 'block', data: { variant: { type: 'function', name: 'EQ', variables: [] } } },
        { type: 'comment', data: {} },
      ],
    })

    expect(keys.size).toBe(0)
  })

  it('classifies fresh, stale, unavailable and invalid samples', () => {
    const now = 5000
    const values = new Map([
      ['fresh', 'TRUE'],
      ['stale', '0'],
      ['invalid', 'ERR'],
      ['missing-time', '1'],
    ])
    const updatedAt = new Map([
      ['fresh', now],
      ['stale', now - GRAPHICAL_DEBUG_STALE_AFTER_MS - 1],
      ['invalid', now],
    ])

    expect(getGraphicalDebugSample(values, updatedAt, 'fresh', now)).toEqual({ value: 'TRUE', quality: 'sampled' })
    expect(getGraphicalDebugSample(values, updatedAt, 'stale', now).quality).toBe('stale')
    expect(getGraphicalDebugSample(values, updatedAt, 'invalid', now).quality).toBe('type-error')
    expect(getGraphicalDebugSample(values, updatedAt, 'missing-time', now).quality).toBe('unavailable')
    expect(getGraphicalDebugSample(values, updatedAt, 'missing', now)).toEqual({
      value: undefined,
      quality: 'unavailable',
    })
  })

  it('parses only fresh IEC boolean values', () => {
    expect(parseGraphicalDebugBoolean({ value: ' true ', quality: 'sampled' })).toBe(true)
    expect(parseGraphicalDebugBoolean({ value: '1', quality: 'sampled' })).toBe(true)
    expect(parseGraphicalDebugBoolean({ value: 'FALSE', quality: 'sampled' })).toBe(false)
    expect(parseGraphicalDebugBoolean({ value: '0', quality: 'sampled' })).toBe(false)
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'exact-runtime' })).toBe(true)
    expect(parseGraphicalDebugBoolean({ value: 'FALSE', quality: 'exact-derived' })).toBe(false)
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'estimated' })).toBe(true)
    expect(parseGraphicalDebugBoolean({ value: '2', quality: 'sampled' })).toBeUndefined()
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'stale' })).toBeUndefined()
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'unavailable' })).toBeUndefined()
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'type-error' })).toBeUndefined()
    expect(parseGraphicalDebugBoolean({ value: 'TRUE', quality: 'build-mismatch' })).toBeUndefined()
    expect(parseGraphicalDebugBoolean({ value: undefined, quality: 'sampled' })).toBeUndefined()
  })
})
