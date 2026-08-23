import type { IecDebugMetadata, IecDebugStatus } from '@root/types/PLC/iec-debug'

import {
  applyGraphicalBooleanNegation,
  collectGraphicalDebugWatchKeys,
  combineLdParallelInputs,
  evaluateLdCoil,
  evaluateLdContact,
  findGraphicalDebugBinding,
  getGraphicalDebugSample,
  getGraphicalDebugSourcesForStatement,
  getGraphicalIecDebugNodeState,
  GRAPHICAL_DEBUG_STALE_AFTER_MS,
  parseGraphicalDebugBoolean,
  resolveFbdEdgeSamples,
  weakestGraphicalDebugQuality,
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

  it('requests only block outputs connected in the visible graph', () => {
    const keys = collectGraphicalDebugWatchKeys({
      availableKeys,
      makeCompositeKey,
      edges: [{ id: 'edge', source: 'counter', target: 'sink', sourceHandle: 'Value' }],
      nodes: [
        {
          id: 'counter',
          type: 'block',
          data: {
            variable: { name: 'Counter' },
            executionControl: true,
            variant: {
              type: 'function-block',
              variables: [
                { name: 'Value', class: 'output' },
                { name: 'Done', class: 'output' },
              ],
            },
          },
        },
      ],
    })

    expect([...keys]).toEqual(['main:Counter.Value'])
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
    expect(applyGraphicalBooleanNegation({ value: 'TRUE', quality: 'sampled' }, true)).toEqual({
      value: 'FALSE',
      quality: 'sampled',
    })
    expect(applyGraphicalBooleanNegation({ value: '42', quality: 'sampled' }, true).quality).toBe('type-error')
    expect(applyGraphicalBooleanNegation({ value: undefined, quality: 'unavailable' }, true).quality).toBe(
      'unavailable',
    )
    expect(applyGraphicalBooleanNegation({ value: 'TRUE', quality: 'sampled' }, false).value).toBe('TRUE')
  })

  it('propagates FBD connection values through connectors without inventing unknown function results', () => {
    const nodes = [
      { id: 'source', type: 'input-variable', data: {} },
      { id: 'connector', type: 'connector', data: {} },
      { id: 'unknown', type: 'block', data: {} },
    ]
    const edges = [
      { id: 'source-wire', source: 'source', target: 'connector' },
      { id: 'connector-wire', source: 'connector', target: 'unknown' },
      { id: 'unknown-wire', source: 'unknown', target: 'sink', sourceHandle: 'OUT' },
    ]
    const samples = resolveFbdEdgeSamples(nodes, edges, (nodeId) =>
      nodeId === 'source' ? { value: '13', quality: 'sampled' } : { value: undefined, quality: 'unavailable' },
    )

    expect(samples.get('source-wire')).toEqual({ value: '13', quality: 'sampled' })
    expect(samples.get('connector-wire')).toEqual({ value: '13', quality: 'sampled' })
    expect(samples.get('unknown-wire')).toEqual({ value: undefined, quality: 'unavailable' })
    expect(
      resolveFbdEdgeSamples(
        [
          { id: 'cycle-a', type: 'connector', data: {} },
          { id: 'cycle-b', type: 'connector', data: {} },
        ],
        [
          { id: 'cycle-1', source: 'cycle-a', target: 'cycle-b' },
          { id: 'cycle-2', source: 'cycle-b', target: 'cycle-a' },
        ],
        () => ({ value: 'unexpected', quality: 'sampled' }),
      ).get('cycle-1'),
    ).toEqual({ value: undefined, quality: 'unavailable' })
    expect(
      resolveFbdEdgeSamples([], [{ id: 'orphan', source: 'missing', target: 'sink' }], () => ({
        value: 'unexpected',
        quality: 'sampled',
      })).get('orphan'),
    ).toEqual({ value: undefined, quality: 'unavailable' })
  })

  it('evaluates normal, negated and sampled edge contacts without pretending edge pulses are exact', () => {
    const powered = { value: 'TRUE', quality: 'exact-derived' } as const
    const active = { value: 'TRUE', quality: 'sampled' } as const
    expect(evaluateLdContact(powered, active, 'default')).toEqual({ value: 'TRUE', quality: 'sampled' })
    expect(evaluateLdContact(powered, active, 'negated')).toEqual({ value: 'FALSE', quality: 'sampled' })
    expect(evaluateLdContact(powered, active, 'risingEdge', true)).toEqual({
      value: 'TRUE',
      quality: 'estimated',
    })
    expect(evaluateLdContact(powered, active, 'fallingEdge')).toEqual({
      value: undefined,
      quality: 'estimated',
    })
    expect(evaluateLdContact({ value: 'FALSE', quality: 'exact-derived' }, active, 'default')).toEqual({
      value: 'FALSE',
      quality: 'exact-derived',
    })
    expect(evaluateLdContact({ value: undefined, quality: 'unavailable' }, active, 'default')).toEqual({
      value: undefined,
      quality: 'unavailable',
    })
    expect(evaluateLdContact(powered, { value: 'not-bool', quality: 'type-error' }, 'default')).toEqual({
      value: undefined,
      quality: 'type-error',
    })
  })

  it('combines parallel branches and keeps actual coil values separate from calculated rung power', () => {
    expect(combineLdParallelInputs([])).toEqual({ value: 'FALSE', quality: 'exact-derived' })
    expect(
      combineLdParallelInputs([
        { value: 'FALSE', quality: 'exact-derived' },
        { value: 'FALSE', quality: 'sampled' },
      ]),
    ).toEqual({ value: 'FALSE', quality: 'sampled' })
    expect(
      combineLdParallelInputs([
        { value: 'FALSE', quality: 'exact-derived' },
        { value: 'TRUE', quality: 'sampled' },
      ]),
    ).toEqual({ value: 'TRUE', quality: 'sampled' })
    expect(
      combineLdParallelInputs([
        { value: 'FALSE', quality: 'exact-derived' },
        { value: undefined, quality: 'unavailable' },
      ]),
    ).toEqual({ value: undefined, quality: 'unavailable' })

    expect(
      evaluateLdCoil({ value: 'TRUE', quality: 'exact-derived' }, { value: 'FALSE', quality: 'sampled' }, 'default'),
    ).toMatchObject({ assignedValue: true, actualValue: false, differs: true, quality: 'sampled' })
    expect(
      evaluateLdCoil({ value: 'TRUE', quality: 'exact-derived' }, { value: 'TRUE', quality: 'sampled' }, 'reset'),
    ).toMatchObject({ assignedValue: false, actualValue: true, differs: true })
    expect(
      evaluateLdCoil({ value: 'FALSE', quality: 'exact-derived' }, { value: 'TRUE', quality: 'sampled' }, 'set'),
    ).toMatchObject({ assignedValue: undefined, actualValue: true, differs: false })
    expect(
      evaluateLdCoil({ value: 'TRUE', quality: 'sampled' }, { value: 'FALSE', quality: 'sampled' }, 'negated'),
    ).toMatchObject({ assignedValue: false, actualValue: false, differs: false })
    expect(
      evaluateLdCoil({ value: 'TRUE', quality: 'sampled' }, { value: 'FALSE', quality: 'sampled' }, 'risingEdge'),
    ).toMatchObject({ assignedValue: undefined, quality: 'estimated' })
    expect(weakestGraphicalDebugQuality('exact-runtime', 'estimated', 'sampled')).toBe('estimated')
  })

  it('resolves current statements and breakpoints for a graphical node', () => {
    const metadata: IecDebugMetadata = {
      format: 'eurosonic-plc-debug',
      version: 1,
      id_algorithm: 'fnv1a32',
      build_id: 'test',
      pous: [{ id: 10, key: 'pou', name: 'FBDTEST', kind: 'program' }],
      statements: [],
      variables: [],
      instances: [],
      graphical_bindings: [
        {
          pou_id: 10,
          language: 'fbd',
          node_id: 'add-node',
          local_id: '3168552',
          kind: 'block',
          statement_ids: [20, 21],
          breakpoint_statement_id: 21,
          source_line: 80,
          source_spans: [],
          pins: [],
        },
        {
          pou_id: 10,
          language: 'fbd',
          node_id: 'output-node',
          local_id: '400',
          kind: 'output-variable',
          statement_ids: [21],
          breakpoint_statement_id: 20,
          source_line: 81,
          source_spans: [],
          pins: [],
        },
      ],
    }
    const haltedStatus = {
      state: 1,
      currentPouId: 10,
      currentStatementId: 21,
    } as IecDebugStatus

    expect(findGraphicalDebugBinding(metadata, 'fbdtest', 'add-node')).toMatchObject({
      breakpoint_statement_id: 21,
    })
    expect(getGraphicalIecDebugNodeState(metadata, haltedStatus, new Set([21]), 'fbdtest', 'add-node')).toMatchObject({
      isCurrent: true,
      hasBreakpoint: true,
    })
    expect(getGraphicalDebugSourcesForStatement(metadata, 10, 21)).toMatchObject({
      primary: { node_id: 'add-node' },
      secondary: [{ node_id: 'output-node' }],
    })
    expect(
      getGraphicalDebugSourcesForStatement(
        {
          ...metadata,
          graphical_bindings: [
            { ...metadata.graphical_bindings![1], node_id: 'z-output' },
            { ...metadata.graphical_bindings![0], node_id: 'b-block', breakpoint_statement_id: 20 },
            { ...metadata.graphical_bindings![0], node_id: 'a-block', breakpoint_statement_id: 20 },
          ],
        },
        10,
        21,
      ).primary,
    ).toMatchObject({ node_id: 'a-block' })
    expect(
      getGraphicalIecDebugNodeState(
        metadata,
        { ...haltedStatus, currentInstanceId: 100 },
        new Set([21]),
        'fbdtest',
        'add-node',
        undefined,
        200,
      ),
    ).toMatchObject({ isCurrent: false, hasBreakpoint: true })
    expect(
      getGraphicalIecDebugNodeState(metadata, { ...haltedStatus, state: 0 }, new Set(), 'fbdtest', 'add-node'),
    ).toMatchObject({
      isCurrent: false,
      hasBreakpoint: false,
    })
    expect(
      findGraphicalDebugBinding({ ...metadata, graphical_bindings: undefined }, 'fbdtest', 'add-node'),
    ).toBeUndefined()
    expect(findGraphicalDebugBinding(metadata, 'missing', 'add-node')).toBeUndefined()
    expect(getGraphicalDebugSourcesForStatement(null, 10, 21)).toEqual({ primary: undefined, secondary: [] })
  })
})
