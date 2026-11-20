import { CodexEditReply, CodexProposal, parseCodexEditReply } from '../../types/IPC/codex-edits'
import type { RootState } from '../store'
import { defaultDeviceConfiguration } from '../store/slices/device/data'
import { buildCodexContext } from './codex-context'
import { createCodexEditController } from './codex-direct-edits'
import { prepareCodexChanges, prepareCodexUndo } from './codex-edits'

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
const batch = (): CodexEditReply => ({
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
const proposal = (state: RootState, reply = batch()): CodexProposal => ({ base: buildCodexContext(state), reply })

test('direct controller creates ST/C++ code once and undo restores previous unsaved buffers', () => {
  let state = fixture()
  const before = JSON.stringify(state)
  const write = jest.fn((patch: Partial<RootState>) => {
    state = { ...state, ...patch }
  })
  const controller = createCodexEditController(() => state, write)
  const message = { id: 'edit', role: 'assistant' as const, text: '', proposal: proposal(state) }
  expect(controller.apply(message)).toBe(true)
  expect(state.project.data.pous).toHaveLength(3)
  expect(state.workspace.editingState).toBe('unsaved')
  expect(controller.apply(message)).toBe(true)
  expect(write).toHaveBeenCalledTimes(1)
  controller.undo()
  expect(JSON.stringify(state)).toBe(before)
  expect(controller.snapshot().outcomes.edit.status).toBe('undone')
})

test.each(['debugger', 'codexDebugger', 'save', 'stale', 'invalid'])(
  'direct controller blocks %s without modifying any project data',
  (mode) => {
    let state = fixture()
    const message = { id: 'edit', role: 'assistant' as const, text: '', proposal: proposal(state) }
    if (mode === 'debugger') state.workspace.isDebuggerVisible = true
    if (mode === 'codexDebugger') state.workspace.codexDebuggerActive = true
    if (mode === 'save') state.workspace.editingState = 'save-request'
    if (mode === 'stale') state.project.data.pous[0].data.documentation = 'new work'
    if (mode === 'invalid') message.proposal.reply.changes[1].name = 'Existing'
    const before = JSON.stringify(state),
      write = jest.fn((patch: Partial<RootState>) => {
        state = { ...state, ...patch }
      })
    const controller = createCodexEditController(() => state, write)
    expect(controller.apply(message)).toBe(false)
    expect(controller.snapshot().outcomes.edit.status).toBe('blocked')
    expect(write).not.toHaveBeenCalled()
    expect(JSON.stringify(state)).toBe(before)
  },
)

test('direct undo refuses to overwrite later manual work', () => {
  let state = fixture()
  const controller = createCodexEditController(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
  )
  controller.apply({ id: 'edit', role: 'assistant', text: '', proposal: proposal(state) })
  state.project.data.pous[0].data.documentation = 'newer manual edit'
  expect(() => controller.undo()).toThrow('edited or saved')
  expect(state.project.data.pous).toHaveLength(3)
  expect(state.project.data.pous[0].data.documentation).toBe('newer manual edit')
})

test('direct creation labels programs without task instances as unscheduled', () => {
  let state = fixture()
  const controller = createCodexEditController(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
  )
  const reply = batch()
  reply.instances = []
  expect(controller.apply({ id: 'edit', role: 'assistant', text: '', proposal: proposal(state, reply) })).toBe(true)
  expect(controller.snapshot().outcomes.edit.detail).toContain('Not scheduled: BlinkProgram')
})

test('prepares an atomic C++ FB, ST caller and task instance without mutation, disk writes or lost buffers', () => {
  const s = fixture(),
    before = JSON.stringify(s)
  const transaction = prepareCodexChanges(s, proposal(s))
  const after = { ...s, ...transaction.patch }
  expect(JSON.stringify(s)).toBe(before)
  expect(after.project.data.pous).toHaveLength(3)
  expect(after.project.data.pous[0]).toEqual(s.project.data.pous[0])
  expect(after.editor).toEqual(s.editor)
  expect(after.project.data.pous[2].data.variables[0].type).toEqual({ definition: 'derived', value: 'BlinkNative' })
  expect(after.project.data.configuration.resource.instances).toEqual(batch().instances)
  expect(after.libraries.user).toContainEqual({ name: 'BlinkNative', type: 'function-block' })
  expect(after.files.BlinkProgram).toMatchObject({ type: 'program', saved: false })
  expect(after.files.Resource.saved).toBe(false)
  const undo = prepareCodexUndo(after, transaction.undo)
  expect(undo.project).toEqual(s.project)
  expect(undo.files).toEqual(s.files)
  expect(undo.editor).toEqual(s.editor)
})

test('updates a pending ST program and synchronizes declarations for active and cached editors', () => {
  const s = fixture()
  s.editors = [s.editor]
  const reply: CodexEditReply = {
    message: '',
    instances: [],
    changes: [
      {
        operation: 'update',
        name: 'Existing',
        kind: 'program',
        language: 'st',
        returnType: '',
        documentation: 'keep',
        declarations: 'VAR\n Counter : UDINT;\n Extra : BOOL;\nEND_VAR',
        body: 'Counter := Counter + 1;',
      },
    ],
  }
  const result = prepareCodexChanges(s, proposal(s, reply)).patch
  expect(result.editor).toMatchObject({ variable: { display: 'code', code: reply.changes[0].declarations } })
  expect(result.editors[0]).toEqual(result.editor)
  expect(result.project.data.pous[0].data.body.value).toBe('Counter := Counter + 1;')
})

test.each(['function', 'function-block'] as const)('creates ST %s with the correct library entry', (kind) => {
  const s = fixture(),
    reply = batch()
  reply.changes = [
    {
      ...reply.changes[1],
      name: 'ComputeValue',
      kind,
      returnType: kind === 'function' ? 'INT' : '',
      declarations: 'VAR_INPUT\n Value : INT;\nEND_VAR',
      body: kind === 'function' ? 'ComputeValue := Value + 1;' : '',
    },
  ]
  reply.instances = []
  const after = prepareCodexChanges(s, proposal(s, reply)).patch
  expect(after.project.data.pous[1].type).toBe(kind)
  expect(after.libraries.user).toContainEqual({ name: 'ComputeValue', type: kind })
})

test('rejects a stale or foreign snapshot and preserves newer unsaved work', () => {
  const s = fixture(),
    p = proposal(s)
  s.project.data.pous[0].data.body = { language: 'st', value: 'new user edit' }
  expect(() => prepareCodexChanges(s, p)).toThrow('project changed')
  p.base = buildCodexContext(s)
  p.base.projectPath = 'C:/other'
  expect(() => prepareCodexChanges(s, p)).toThrow('project changed')
  expect(s.project.data.pous[0].data.body.value).toBe('new user edit')
})

test.each(['existing', '../escape', '__proto__', 'CON', 'VAR'])('rejects colliding/unsafe POU name %s', (name) => {
  const s = fixture(),
    r = batch()
  r.changes[0].name = name
  expect(() => prepareCodexChanges(s, proposal(s, r))).toThrow()
  expect(s.project.data.pous).toHaveLength(1)
})

test.each(['VAR\n A : BOOL;', 'ignored outside block', 'VAR\n A : BOOL\nEND_VAR', 'VAR\n A : UnknownType;\nEND_VAR'])(
  'rejects invalid declarations atomically: %s',
  (text) => {
    const s = fixture(),
      r = batch()
    r.changes[1].declarations = text
    expect(() => prepareCodexChanges(s, proposal(s, r))).toThrow()
    expect(s.project.data.pous).toHaveLength(1)
    expect(s.files.BlinkNative).toBeUndefined()
  },
)

test('rejects unsupported C++ programs, wrong target and invalid C++ entry points', () => {
  const s = fixture(),
    r = batch()
  r.changes[0].kind = 'program'
  expect(() => parseCodexEditReply(JSON.stringify(r))).toThrow()
  r.changes[0].kind = 'function-block'
  r.changes[0].body = 'void main() {}'
  expect(() => prepareCodexChanges(s, proposal(s, r))).toThrow('setup')
  s.deviceDefinitions.configuration.deviceBoard = 'other'
  expect(() => prepareCodexChanges(s, proposal(s))).toThrow('Eurosonic compiler')
})

test('protects existing FB interfaces, IO bindings, language and function return types', () => {
  const s = fixture(),
    first = prepareCodexChanges(s, proposal(s)),
    after = { ...s, ...first.patch }
  const r = batch()
  r.instances = []
  r.changes = [{ ...r.changes[0], operation: 'update', declarations: 'VAR_OUTPUT\n Renamed : BOOL;\nEND_VAR' }]
  expect(() => prepareCodexChanges(after, proposal(after, r))).toThrow('public interface')
  r.changes = [
    {
      ...batch().changes[1],
      operation: 'update',
      declarations: 'VAR\n Blink : BlinkNative;\n Lamp AT %QX140.0 : BOOL;\nEND_VAR',
    },
  ]
  expect(() => prepareCodexChanges(after, proposal(after, r))).toThrow('located variable')
  r.changes[0].language = 'cpp'
  r.changes[0].kind = 'function-block'
  expect(() => prepareCodexChanges(after, proposal(after, r))).toThrow('exact existing')
})

test('blocks missing tasks, duplicate scheduling and applying with debugger attached', () => {
  const s = fixture(),
    r = batch()
  r.instances[0].task = 'missing'
  expect(() => prepareCodexChanges(s, proposal(s, r))).toThrow('existing task')
  r.instances = [...batch().instances, { ...batch().instances[0], name: 'second' }]
  expect(() => prepareCodexChanges(s, proposal(s, r))).toThrow('already exists')
  s.workspace.isDebuggerVisible = true
  expect(() => prepareCodexChanges(s, proposal(s))).toThrow('Disconnect')
})

test('undo refuses intervening edits or saves and leaves newer work intact', () => {
  const s = fixture(),
    first = prepareCodexChanges(s, proposal(s)),
    after = { ...s, ...first.patch }
  after.files = { ...after.files, BlinkNative: { ...after.files.BlinkNative, saved: true } }
  expect(() => prepareCodexUndo(after, first.undo)).toThrow('edited or saved')
  after.files = first.patch.files
  after.project = { ...after.project, meta: { ...after.project.meta, name: 'renamed' } }
  expect(() => prepareCodexUndo(after, first.undo)).toThrow('edited or saved')
})
