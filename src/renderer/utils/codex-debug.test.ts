import { describeCodexDebug } from '../../types/IPC/codex-debug'
import type { IecDebugStatus } from '../../types/PLC/iec-debug'
import type { RootState } from '../store'
import { defaultDeviceConfiguration } from '../store/slices/device/data'
import { createDebugObservations } from './codex-debug'

function fixture() {
  const state = {
    project: { meta: { path: 'C:/private/project' } },
    deviceDefinitions: { configuration: { ...defaultDeviceConfiguration, deviceBoard: 'Eurosonic_Gen2_8KW' } },
    workspace: {
      isDebuggerVisible: true,
      debuggerTargetIp: '192.0.2.1',
      editingState: 'unsaved',
      debugVariableIndexes: new Map([['main:Blink.Lamp', 2]]),
      debugVariableValues: new Map([['main:Blink.Lamp', 'old cache']]),
      debugVariableUpdatedAt: new Map([['main:Blink.Lamp', 100]]),
      fbSelectedInstance: new Map([['CppBlink', 'main:Blink']]),
      plcLogs: 'private log',
      iecDebugMetadata: {
        build_id: 'local-build',
        pous: [{ id: 2, name: 'main' }],
        statements: [{ id: 9, pou_id: 2, line: 3, file: 'C:/private/program.st' }],
        instances: [{ id: 4, path: 'RES0.instance0' }],
      },
    },
  } as unknown as RootState
  const cache = createDebugObservations()
  const token = cache.begin(state, 1000)
  const record = (value = 'TRUE', time = 1100) =>
    cache.values(token, state, new Map([['main:Blink.Lamp', value]]), new Map([['main:Blink.Lamp', time]]), new Map())
  return { state, cache, token, record }
}
const halted: IecDebugStatus = {
  state: 1,
  currentStatementId: 9,
  currentPouId: 2,
  currentInstanceId: 4,
  haltCount: '5',
  pointCount: '100',
  breakpointCount: 1,
  breakpointCapacity: 64,
}

test('observes existing samples without mutating buffers, transmitting paths/logs or claiming verified source', () => {
  const { state, cache, token, record } = fixture()
  const serialize = () => JSON.stringify(state, (_key, value: unknown) => (value instanceof Map ? [...value] : value))
  const before = serialize()
  record()
  cache.status(token, state, halted, 1100)
  cache.stack(token, state, [{ pouId: 2, instanceId: 4, statementId: 9 }], '5', 1150)
  const snapshot = cache.snapshot(state, 1200)
  expect(describeCodexDebug(snapshot, 1200)).toMatchObject({
    sourceMatch: 'unverified',
    unsavedChanges: true,
    localBuildId: 'local-build',
    statusFreshness: 'recent-sample',
    callStackFreshness: 'recent-sample',
    status: { location: { pou: 'main', instance: 'RES0.instance0', line: 3 } },
    variables: [{ key: 'main:Blink.Lamp', value: 'TRUE', freshness: 'recent-sample', forced: null }],
  })
  expect(JSON.stringify(snapshot)).not.toMatch(/C:\/private|private log|old cache/)
  expect(serialize()).toEqual(before)
})

test.each(['disconnect', 'target', 'project', 'board', 'transport'])(
  'invalidates %s binding and rejects delayed responses and cache reuse',
  (change) => {
    const { state, cache, token, record } = fixture()
    record()
    const original = structuredClone(state)
    if (change === 'disconnect') state.workspace.isDebuggerVisible = false
    if (change === 'target') state.workspace.debuggerTargetIp = '192.0.2.2'
    if (change === 'project') state.project.meta.path = 'C:/other'
    if (change === 'board') state.deviceDefinitions.configuration.deviceBoard = 'other'
    if (change === 'transport') state.deviceDefinitions.configuration.communicationPort = 'COM9'
    cache.status(token, state, halted, 1200)
    expect(cache.snapshot(state, 1300)).toMatchObject({ sessionMatches: false, variables: [], status: null })
    expect(cache.snapshot(original, 1400)).toMatchObject({ sessionMatches: false, variables: [] })
  },
)

test('new connection ignores old session responses, cleanup and carried-forward timestamps', () => {
  const { state, cache, token, record } = fixture()
  record()
  const next = cache.begin(state, 2000)
  cache.end(token)
  record('old response', 2200)
  cache.values(
    next,
    state,
    new Map([['main:Blink.Lamp', 'old cache']]),
    new Map([['main:Blink.Lamp', 1100]]),
    new Map(),
  )
  expect(cache.snapshot(state, 2300).variables).toEqual([])
  cache.values(
    next,
    state,
    new Map([['main:Blink.Lamp', 'FALSE']]),
    new Map([['main:Blink.Lamp', 2200]]),
    new Map([['main:Blink.Lamp', 2200]]),
  )
  expect(cache.snapshot(state, 2300).variables).toEqual([])
})

test('legacy samples work without IEC metadata; freshness is evaluated again at send time', () => {
  const { state, cache, record } = fixture()
  state.workspace.iecDebugMetadata = null
  record()
  const snapshot = cache.snapshot(state, 1200)
  expect(snapshot.status).toBeNull()
  expect(describeCodexDebug(snapshot, 7000).variables[0].freshness).toBe('stale')
  expect(describeCodexDebug(snapshot, 1000).variables[0].freshness).toBe('invalid-time')
  record('ERR', 1300)
  expect(describeCodexDebug(cache.snapshot(state, 1400), 1400).variables[0].freshness).toBe('unavailable')
})

test('stack is cleared when execution continues or a different halt arrives', () => {
  const { state, cache, token } = fixture()
  cache.status(token, state, halted, 1100)
  cache.stack(token, state, [{ pouId: 2, instanceId: 4, statementId: 9 }], '5', 1200)
  cache.status(token, state, { ...halted, haltCount: '6' }, 1300)
  cache.stack(token, state, [{ pouId: 2, instanceId: 4, statementId: 9 }], '5', 1400)
  expect(cache.snapshot(state, 1500).callStack).toBeNull()
  cache.stack(token, state, [{ pouId: 2, instanceId: 4, statementId: 9 }], '6', 1600)
  cache.status(token, state, { ...halted, state: 0 }, 1700)
  expect(cache.snapshot(state, 1800).callStack).toBeNull()
})

test('bounded values report truncation and changed/deleted variable indexes are excluded', () => {
  const { state, cache, token } = fixture()
  const values = new Map<string, string>(),
    timestamps = new Map<string, number>()
  for (let i = 0; i < 300; i++) {
    state.workspace.debugVariableIndexes.set(`main:v${i}`, i)
    values.set(`main:v${i}`, 'TRUE')
    timestamps.set(`main:v${i}`, 1100)
  }
  cache.values(token, state, values, timestamps, new Map(), new Map([['main:v44', true]]))
  let snapshot = cache.snapshot(state, 1200)
  expect(snapshot.variables).toHaveLength(64)
  expect(snapshot.omittedVariables).toBe(192)
  expect(snapshot.cacheLimited).toBe(true)
  expect(snapshot.variables[0]).toMatchObject({ key: 'main:v44', forced: true })
  state.workspace.debugVariableIndexes.delete('main:v44')
  state.workspace.debugVariableIndexes.set('main:v45', 900)
  snapshot = cache.snapshot(state, 1200)
  expect(snapshot.variables.some((v) => ['main:v44', 'main:v45'].includes(v.key))).toBe(false)
})
