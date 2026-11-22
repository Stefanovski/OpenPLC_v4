import { gvlFixture } from '../../../scripts/eurosonic/fixtures/gvl'
import { describeCodexContext, MAX_CODEX_CONTEXT_BYTES, parseCodexContext } from '../../types/IPC/codex-context'
import type { IoInventory } from '../../types/PLC/io-inventory'
import type { RootState } from '../store'
import { buildCodexContext } from './codex-context'
import {
  beginIoObservation,
  cancelIoObservation,
  clearIoObservation,
  finishIoObservation,
  getIoObservation,
  type IoObservation,
} from './io-observation'

const now = 100000
const inventory = (): IoInventory => ({
  host: '192.168.1.10',
  readAt: now - 1000,
  verified: true,
  modules: Array.from({ length: 7 }, (_, i) => ({
    slot: i + 1,
    type: i === 1 ? 1 : 0,
    ident: i === 1 ? 32 : 0,
    registerCount: i === 1 ? 1 : 0,
    version: i === 1 ? 1 : 0,
    communicationOk: i === 1,
  })),
})
const observation = (): IoObservation => ({
  projectPath: 'C:/private/project',
  board: 'Eurosonic_Gen2_8KW',
  configuredHost: '192.168.1.10',
  requestedHost: '192.168.1.10',
  state: 'success',
  inventory: inventory(),
})
const source = () =>
  ({
    project: {
      meta: { name: 'Unsaved PLC', path: 'C:/private/project' },
      data: {
        pous: [
          {
            type: 'function-block',
            data: {
              name: 'CppBlink',
              documentation: 'Blink',
              variables: [{ name: 'OLD' }],
              body: { language: 'cpp', value: 'void loop() { Lamp = !Lamp; }' },
            },
          },
          {
            type: 'program',
            data: { name: 'Main', documentation: '', variables: [], body: { language: 'st', value: 'Blink();' } },
          },
          {
            type: 'function',
            data: {
              name: 'AddOne',
              documentation: '',
              returnType: 'INT',
              variables: [],
              body: { language: 'st', value: 'AddOne := Value + 1;' },
            },
          },
          {
            type: 'program',
            data: {
              name: 'Diagram',
              documentation: '',
              variables: [],
              body: { language: 'fbd', value: { name: 'Diagram', rung: { comment: 'OLD', nodes: [], edges: [] } } },
            },
          },
          {
            type: 'program',
            data: {
              name: 'Ladder',
              documentation: '',
              variables: [],
              body: { language: 'ld', value: { name: 'Ladder', rungs: [] } },
            },
          },
        ],
        dataTypes: [{ name: 'Mode', derivation: 'enumerated', values: [{ description: 'Idle' }] }],
        configuration: {
          resource: {
            globalVariables: [{ name: 'STALE_GLOBAL' }],
            tasks: [{ name: 'task0', interval: 'T#10ms', triggering: 'Cyclic', priority: 1 }],
            instances: [{ name: 'instance0', task: 'task0', program: 'Main' }],
          },
        },
      },
    },
    editor: {
      type: 'plc-textual',
      meta: { name: 'CppBlink' },
      variable: { display: 'code', code: 'VAR_OUTPUT\n Lamp : BOOL\nEND_VAR' },
    },
    editors: [
      { type: 'plc-textual', meta: { name: 'CppBlink' }, variable: { display: 'code', code: 'OLDER EDITOR' } },
      {
        type: 'plc-resource',
        meta: { name: 'Resource' },
        variable: { display: 'code', code: 'VAR_GLOBAL\n UNFINISHED' },
      },
    ],
    fbdFlows: [{ name: 'Diagram', rung: { comment: 'unsaved graph', nodes: [{ id: 'new node' }], edges: [] } }],
    ladderFlows: [{ name: 'Ladder', rungs: [{ id: 'new rung', nodes: [], edges: [] }] }],
    workspace: { editingState: 'unsaved' },
    deviceDefinitions: {
      configuration: {
        deviceBoard: 'Eurosonic_Gen2_8KW',
        runtimeIpAddress: '192.168.1.10',
        communicationPort: '',
        runtimeJwt: 'secret-jwt',
        password: 'secret-password',
        ioLayout: inventory().modules.map(({ slot, type, ident, registerCount }) => ({
          slot,
          type,
          ident,
          registerCount,
        })),
        communicationConfiguration: { modbusTCP: { tcpStaticHostConfiguration: { ipAddress: '' } } },
      },
      pinMapping: { pins: [{ name: 'Lamp', location: '%QX120.0' }] },
    },
    deviceAvailableOptions: {
      availableBoards: new Map([['Eurosonic_Gen2_8KW', { compiler: 'eurosonic-cli', coreVersion: '2.11.0' }]]),
    },
    debugger: { secret: 'debugger-private-state' },
  }) as unknown as RootState

const capture = (s = source(), obs = observation()) => parseCodexContext(buildCodexContext(s, obs, now).snapshot)

test('captures pending bodies, incomplete declarations and resource associations without mutating or saving', () => {
  const serialize = (value: unknown) =>
    JSON.stringify(value, (_key, item: unknown) => (item instanceof Map ? [...item] : item))
  const s = source(),
    before = serialize(s)
  const context = capture(s)
  expect(context.project.pous[0]).toMatchObject({
    declarations: { source: 'raw-text', text: 'VAR_OUTPUT\n Lamp : BOOL\nEND_VAR' },
    body: 'void loop() { Lamp = !Lamp; }',
  })
  expect(context.project.pous[0].declarations.variables).toBeUndefined()
  expect(context.project.resource.globals).toEqual({ source: 'raw-text', text: 'VAR_GLOBAL\n UNFINISHED' })
  expect(context.project.resource.tasks[0]).toMatchObject({ interval: 'T#10ms' })
  expect(context.project.resource.instances[0]).toMatchObject({ program: 'Main', task: 'task0' })
  expect(context.project.pous[2].returnType).toBe('INT')
  expect(context.project.dataTypes).toHaveLength(1)
  expect(serialize(s)).toBe(before)
})

test('uses latest FBD/LD store bodies and detaches snapshots from later edits', () => {
  const s = source(),
    context = capture(s)
  s.fbdFlows[0].rung.comment = 'later change'
  expect(context.project.pous[3].body).toMatchObject({
    rung: { comment: 'unsaved graph', nodes: [{ id: 'new node' }] },
  })
  expect(context.project.pous[4].body).toMatchObject({ rungs: [{ id: 'new rung' }] })
})

test('does not send runtime credentials, project path or debugger state', () => {
  const attachment = buildCodexContext(source(), observation(), now)
  expect(attachment.projectPath).toBe('C:/private/project')
  for (const secret of [
    'secret-jwt',
    'secret-password',
    'C:/private/project',
    'debugger-private-state',
    'OLDER EDITOR',
    'STALE_GLOBAL',
  ])
    expect(attachment.snapshot).not.toContain(secret)
  expect(capture().device).toMatchObject({ compiler: 'eurosonic-cli', coreVersion: '2.11.0' })
})

test('keeps expected and detected IO separate and supplies channel mapping and standalone background', () => {
  const s = source()
  s.deviceDefinitions.configuration.ioLayout![1].type = 2
  const described = describeCodexContext(capture(s), now)
  expect(described.io.status).toBe('fresh')
  expect(described.io.slots[1]).toMatchObject({ comparison: 'Different module', expected: { name: 'ESX_AI4C_01' } })
  expect(described.io.slots[1].detected?.channels[0]).toEqual({ channel: 1, input: '%IX120.0', output: '%QX120.0' })
  expect(described.background.contractVersion).toBe(1)
  expect(described.background.projectModel.join(' ')).toContain('Creating a POU alone does not schedule it')
  expect(described.generatorGuidance.join(' ')).toContain('Pass variables explicitly to helper functions')
})

test.each(['projectPath', 'board', 'configuredHost'] as const)('drops observation bound to a different %s', (key) => {
  const obs = observation()
  obs[key] = 'different'
  expect(capture(source(), obs).io.observation).toBeNull()
})

test.each(['failed', 'reading'] as const)('retains previous data but marks %s observations unverified', (state) => {
  const obs = observation()
  obs.state = state
  const described = describeCodexContext(capture(source(), obs), now)
  expect(described.io.status).toBe(state)
  expect(described.io.slots[1].detected?.name).toBe('ESX_DIO8C_01')
  expect(described.io.slots.every((slot) => slot.comparison === 'Not verified')).toBe(true)
})

test('rechecks IO age at send time and rejects future timestamps and a different scanned target', () => {
  const c = capture()
  expect(describeCodexContext(c, now + 29000).io.status).toBe('stale')
  expect(describeCodexContext(c, now - 1001).io.status).toBe('stale')
  c.io.observation!.inventory!.host = 'other-target'
  expect(describeCodexContext(c, now).io.status).toBe('different-target')
})

test('does not infer empty/unknown hardware or maps for unsupported targets', () => {
  const c = capture()
  c.io.observation!.inventory!.verified = false
  expect(describeCodexContext(c, now).io.status).toBe('unverified-format')
  c.io.observation!.inventory!.verified = true
  c.io.observation!.inventory!.modules[1].type = 63
  expect(describeCodexContext(c, now).io.slots[1].detected?.channels).toEqual([])
  c.io.observation!.inventory!.modules[1].version = 2
  expect(describeCodexContext(c, now).io.status).toBe('unverified-format')
  c.device.board = 'Arduino'
  expect(describeCodexContext(c, now).io).toMatchObject({ status: 'unsupported-target', slots: [] })
})

test('rejects oversized UTF-8 and invalid schemas without silent truncation', () => {
  const c = capture()
  c.project.pous[0].body = 'ä'.repeat(MAX_CODEX_CONTEXT_BYTES / 2)
  expect(() => parseCodexContext(JSON.stringify(c))).toThrow('too large')
  expect(() => parseCodexContext('{"version":1}')).toThrow()
})

test('observation cache preserves detached data, ignores late requests and clears only matching project', () => {
  const original = observation()
  const first = beginIoObservation(original)
  const second = beginIoObservation(original)
  finishIoObservation(first, inventory())
  expect(getIoObservation()?.state).toBe('reading')
  finishIoObservation(second, inventory())
  const copy = getIoObservation()!
  copy.inventory!.modules[1].type = 63
  expect(getIoObservation()?.inventory?.modules[1].type).toBe(1)
  cancelIoObservation(second)
  expect(getIoObservation()?.state).toBe('success')
  const third = beginIoObservation(original)
  cancelIoObservation(third)
  expect(getIoObservation()?.state).toBe('failed')
  clearIoObservation('other')
  expect(getIoObservation()).toBeDefined()
  clearIoObservation(original.projectPath)
  finishIoObservation(third, inventory())
  expect(getIoObservation()).toBeUndefined()
})

test('includes named GVLs and pending declaration edits in the shared project snapshot', () => {
  const state = source()
  state.project.data.globalVariableLists = gvlFixture().globalVariableLists
  state.project.data.globalVariableLists![1].variablesText = 'VAR_GLOBAL RETAIN\n Count :'
  const before = structuredClone(state.project.data)
  const context = parseCodexContext(buildCodexContext(state, undefined, now).snapshot)
  expect(context.project.resource.globalVariableLists?.[0]).toMatchObject({
    name: 'GVL_IO',
    declarations: { source: 'table' },
  })
  expect(context.project.resource.globalVariableLists?.[1].declarations.text).toBe('VAR_GLOBAL RETAIN\n Count :')
  expect(state.project.data).toEqual(before)
})
