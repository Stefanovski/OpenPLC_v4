import { PlcEditReply, PlcProposal } from '../../types/plc-operations/edits'
import type { RootState } from '../store'
import { defaultDeviceConfiguration } from '../store/slices/device/data'
import { runPlcBuild } from './build'
import { buildPlcContext } from './context'
import { createPlcEditController } from './edit-controller'

function fixture() {
  return {
    project: {
      meta: { name: 'Editing test', type: 'plc-project', path: 'C:/test/project' },
      data: {
        pous: [
          {
            type: 'program',
            data: {
              name: 'Existing',
              language: 'st',
              documentation: 'keep',
              variables: [],
              body: { language: 'st', value: '(* unsaved existing *)' },
            },
          },
        ],
        dataTypes: [],
        deletedPous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
            instances: [],
            globalVariables: [],
          },
        },
      },
    },
    editor: {
      type: 'plc-textual',
      meta: { name: 'Existing', path: '/pous/programs/Existing.st', language: 'st', pouType: 'program' },
      variable: { display: 'code', code: 'VAR\n Counter : UDINT;\nEND_VAR' },
    },
    editors: [],
    tabs: [],
    selectedTab: 'Existing',
    history: {},
    fbdFlows: [],
    ladderFlows: [],
    files: {
      Existing: { type: 'program', saved: false, filePath: '/pous/programs/Existing.st' },
      Resource: { type: 'resource', saved: true, filePath: '/project.json' },
    },
    workspace: { editingState: 'unsaved', isDebuggerVisible: false, debuggerTargetIp: null },
    deviceDefinitions: {
      configuration: { ...defaultDeviceConfiguration, deviceBoard: 'Eurosonic_Gen2_8KW' },
      pinMapping: { pins: [] },
    },
    deviceAvailableOptions: {
      availableBoards: new Map([['Eurosonic_Gen2_8KW', { compiler: 'eurosonic-cli', coreVersion: '2.11.0' }]]),
    },
    libraries: { system: [], user: [] },
  } as unknown as RootState
}
const batch = (): PlcEditReply => ({
  message: 'Proposed, not yet applied.',
  changes: [
    {
      operation: 'create',
      name: 'BlinkNative',
      kind: 'function-block',
      language: 'cpp',
      returnType: '',
      documentation: 'Blink',
      declarations: 'VAR_OUTPUT\n Lamp : BOOL;\nEND_VAR\nVAR\n Counter : UDINT;\nEND_VAR',
      body: 'void setup() { Counter = 0; Lamp = false; }\nvoid loop() { if (++Counter >= 50) { Counter = 0; Lamp = !Lamp; } }',
    },
    {
      operation: 'create',
      name: 'BlinkProgram',
      kind: 'program',
      language: 'st',
      returnType: '',
      documentation: '',
      declarations: 'VAR\n Blink : BlinkNative;\n Lamp AT %QX120.0 : BOOL;\nEND_VAR',
      body: 'Blink();\nLamp := Blink.Lamp;',
    },
  ],
  instances: [{ name: 'blink_instance', program: 'BlinkProgram', task: 'task0' }],
})
const proposal = (state: RootState, reply = batch()): PlcProposal => ({ base: buildPlcContext(state), reply })

test('a provider without Codex messages/account/model can edit and undo the live unsaved project', () => {
  let state = fixture()
  const before = JSON.stringify(state)
  const controller = createPlcEditController(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
  )
  expect(controller.apply({ id: 'provider-independent-request', proposal: proposal(state) })).toBe(true)
  expect(state.project.data.pous).toHaveLength(3)
  expect(state.project.data.configuration.resource.instances).toHaveLength(1)
  controller.undo()
  expect(JSON.stringify(state)).toBe(before)
})
test('a stale second provider cannot replace changes; active debugging and later edits still block undo', () => {
  let state = fixture()
  const controller = createPlcEditController(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
  )
  const stale = proposal(state)
  expect(controller.apply({ id: 'first', proposal: proposal(state) })).toBe(true)
  expect(controller.apply({ id: 'second', proposal: stale })).toBe(false)
  expect(controller.snapshot().outcomes.second.detail).toContain('project changed')
  state.workspace.plcOperationsDebuggerActive = true
  expect(() => controller.undo()).toThrow('Disconnect')
  state.workspace.plcOperationsDebuggerActive = false
  state.project = {
    ...state.project,
    data: {
      ...state.project.data,
      pous: state.project.data.pous.map((p, i) =>
        i || p.type !== 'program'
          ? p
          : { ...p, data: { ...p.data, body: { language: 'st', value: '(* newer manual work *)' } } },
      ),
    },
  }
  expect(() => controller.undo()).toThrow('edited or saved')
})
test('the repair callback is provider-independent and only returns a reviewed proposal, without changing the editor', async () => {
  const state = fixture(),
    before = JSON.stringify(state)
  const repair = jest.fn().mockResolvedValue(batch())
  const compile = jest
    .fn()
    .mockResolvedValueOnce({ success: false, repairable: true, diagnostics: 'fixture diagnostic' })
    .mockResolvedValue({ success: true, repairable: false, diagnostics: 'ok' })
  const result = await runPlcBuild({
    getState: () => state,
    compile,
    repair,
    report: jest.fn(),
    status: jest.fn(),
    signal: new AbortController().signal,
  })
  expect(result?.reply.changes).toHaveLength(2)
  expect(repair).toHaveBeenCalledTimes(1)
  expect(compile).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(state)).toBe(before)
})
