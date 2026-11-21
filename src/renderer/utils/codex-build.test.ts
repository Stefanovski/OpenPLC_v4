import type { CodexBuildRequest, CodexBuildResult } from '../../types/IPC/codex-build'
import type { CodexEditReply } from '../../types/IPC/codex-edits'
import type { RootState } from '../store'
import { defaultDeviceConfiguration } from '../store/slices/device/data'
import { prepareCodexBuild, runCodexBuild } from './codex-build'
import { buildCodexContext } from './codex-context'
import { prepareCodexChanges, prepareCodexUndo } from './codex-edits'

function fixture() {
  return {
    project: {
      meta: { name: 'Compile test', type: 'plc-project', path: 'C:/source' },
      data: {
        pous: [
          {
            type: 'program',
            data: {
              name: 'main',
              language: 'st',
              documentation: '',
              variables: [],
              body: { language: 'st', value: 'Counter := ;' },
            },
          },
        ],
        dataTypes: [],
        deletedPous: [],
        configuration: {
          resource: {
            globalVariables: [],
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
          },
        },
      },
    },
    editor: {
      type: 'plc-textual',
      meta: { name: 'main', path: '/pous/programs/main.st', language: 'st', pouType: 'program' },
      variable: { display: 'code', code: 'VAR\n Counter : UDINT;\nEND_VAR' },
    },
    editors: [],
    fbdFlows: [],
    ladderFlows: [],
    tabs: [],
    selectedTab: 'main',
    history: {},
    files: { main: { type: 'program', saved: false, filePath: '/pous/programs/main.st' } },
    libraries: { system: [], user: [] },
    workspace: { editingState: 'unsaved', isDebuggerVisible: false, debuggerTargetIp: null },
    deviceDefinitions: {
      configuration: { ...defaultDeviceConfiguration, deviceBoard: 'Eurosonic_Gen2_8KW' },
      pinMapping: { pins: [] },
    },
    deviceAvailableOptions: { availableBoards: new Map([['Eurosonic_Gen2_8KW', { compiler: 'eurosonic-cli' }]]) },
  } as unknown as RootState
}
const reply = (body = 'Counter := Counter + 1;'): CodexEditReply => ({
  message: 'Corrected syntax',
  instances: [],
  changes: [
    {
      operation: 'update',
      name: 'main',
      kind: 'program',
      language: 'st',
      returnType: '',
      documentation: '',
      declarations: 'VAR\n Counter : UDINT;\nEND_VAR',
      body,
    },
  ],
})
const failure = { success: false, repairable: true, diagnostics: 'program.st:12: error: invalid expression' }
const success = { success: true, repairable: false, diagnostics: 'BUILD FINISHED SUCCESSFULLY' }
function harness() {
  const state = fixture()
  const controller = new AbortController()
  return {
    state,
    controller,
    deps: {
      getState: () => state,
      compile: jest
        .fn<Promise<CodexBuildResult>, [CodexBuildRequest]>()
        .mockResolvedValueOnce(failure)
        .mockResolvedValue(success),
      repair: jest.fn().mockResolvedValue(reply()),
      report: jest.fn(),
      status: jest.fn(),
      signal: controller.signal,
    },
  }
}

test('compiles current unsaved declarations and code without modifying the source snapshot', () => {
  const state = fixture(),
    before = JSON.stringify(state)
  const request = prepareCodexBuild(state)
  expect(request.data.pous[0].data.variables[0].name).toBe('Counter')
  expect(request.data.pous[0].data.body.value).toBe('Counter := ;')
  expect(Object.keys(request).sort()).toEqual(['board', 'data'])
  expect(JSON.stringify(state)).toEqual(before)
})

test('repairs in isolation, recompiles, returns a reviewed atomic proposal and supports undo', async () => {
  const { state, deps } = harness(),
    before = JSON.stringify(state)
  const proposal = await runCodexBuild(deps)
  expect(JSON.stringify(state)).toEqual(before)
  expect(deps.compile).toHaveBeenCalledTimes(2)
  expect(deps.compile.mock.calls[1][0].data.pous[0].data.body.value).toBe('Counter := Counter + 1;')
  const applied = prepareCodexChanges(state, proposal!)
  expect(prepareCodexUndo({ ...state, ...applied.patch }, applied.undo).project).toEqual(state.project)
})

test('successful initial compilation does not call Codex or create a proposal', async () => {
  const { deps } = harness()
  deps.compile.mockReset().mockResolvedValue(success)
  expect(await runCodexBuild(deps)).toBeNull()
  expect(deps.repair).not.toHaveBeenCalled()
})

test('chat requests reject intervening edits before the first compiler invocation', async () => {
  const { deps, state } = harness()
  const expectedBase = buildCodexContext(state)
  state.project.data.pous[0].data.body.value = 'Counter := 123;'
  await expect(runCodexBuild({ ...deps, expectedBase })).rejects.toThrow('changed since your chat request')
  expect(deps.compile).not.toHaveBeenCalled()
  expect(deps.repair).not.toHaveBeenCalled()
})

test('combines multiple revisions and caps correction attempts at three', async () => {
  const { deps, state } = harness(),
    before = JSON.stringify(state)
  deps.compile.mockReset().mockResolvedValue(failure)
  deps.repair
    .mockReset()
    .mockResolvedValueOnce(reply('Counter := 1;'))
    .mockResolvedValueOnce(reply('Counter := 2;'))
    .mockResolvedValueOnce(reply('Counter := 3;'))
  await expect(runCodexBuild(deps)).rejects.toThrow('3 correction rounds')
  expect(deps.compile).toHaveBeenCalledTimes(4)
  expect(deps.repair).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(state)).toEqual(before)
})

test('merges successive fixes to the same POU into the final verified proposal', async () => {
  const { deps } = harness()
  deps.compile.mockReset().mockResolvedValueOnce(failure).mockResolvedValueOnce(failure).mockResolvedValue(success)
  deps.repair.mockReset().mockResolvedValueOnce(reply('Counter := 1;')).mockResolvedValueOnce(reply('Counter := 2;'))
  expect((await runCodexBuild(deps))!.reply.changes).toEqual(reply('Counter := 2;').changes)
})

test('stops on a repeated correction without applying it', async () => {
  const { deps } = harness()
  deps.compile.mockReset().mockResolvedValue(failure)
  await expect(runCodexBuild(deps)).rejects.toThrow('repeated')
  expect(deps.compile).toHaveBeenCalledTimes(2)
})

test('does not ask the model to repair toolchain/environment failures', async () => {
  const { deps } = harness()
  deps.compile.mockReset().mockResolvedValue({ ...failure, repairable: false })
  await expect(runCodexBuild(deps)).rejects.toThrow('diagnostics')
  expect(deps.repair).not.toHaveBeenCalled()
})

test('rejects stale source, project switches and cancellation after a running compile', async () => {
  for (const mode of ['source', 'project', 'cancel']) {
    const { deps, state, controller } = harness()
    deps.compile.mockReset().mockImplementation(() => {
      if (mode === 'source') state.project.data.pous[0].data.body.value = 'new user edit'
      if (mode === 'project') state.project.meta.path = 'C:/different'
      if (mode === 'cancel') controller.abort()
      return Promise.resolve(failure)
    })
    await expect(runCodexBuild(deps)).rejects.toThrow(/changed|stopped/)
    expect(deps.repair).not.toHaveBeenCalled()
  }
})

test('rejects debugger, saving, incomplete declarations and unsupported targets before any compilation', async () => {
  for (const mode of ['debugger', 'codexDebugger', 'saving', 'declarations', 'target']) {
    const { deps, state } = harness()
    if (mode === 'debugger') state.workspace.isDebuggerVisible = true
    if (mode === 'codexDebugger') state.workspace.plcOperationsDebuggerActive = true
    if (mode === 'saving') state.workspace.editingState = 'save-request'
    if (mode === 'target') state.deviceDefinitions.configuration.deviceBoard = 'other'
    if (mode === 'declarations' && state.editor.type === 'plc-textual')
      state.editor.variable = { display: 'code', code: 'VAR\n Counter: UDINT;' }
    await expect(runCodexBuild(deps)).rejects.toThrow()
    expect(deps.compile).not.toHaveBeenCalled()
  }
})
