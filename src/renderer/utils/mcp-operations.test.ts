import type { McpAction, McpRequest } from '../../types/IPC/mcp'
import { buildPlcContext } from '../operations/context'
import { debugObservations } from '../operations/debug-observations'
import { debugTargetKey } from '../operations/debug-target'
import type { RootState } from '../store'
import { defaultDeviceConfiguration } from '../store/slices/device/data'
import { createMcpEditorOperations } from './mcp-operations'

function fixture() {
  let state = {
    project: {
      meta: { name: 'MCP test', type: 'plc-project', path: 'C:/test/project' },
      data: {
        pous: [
          {
            type: 'program',
            data: {
              name: 'main',
              language: 'st',
              documentation: '',
              variables: [],
              body: { language: 'st', value: '(* unsaved *)' },
            },
          },
        ],
        dataTypes: [],
        deletedPous: [],
        configuration: {
          resource: {
            globalVariables: [],
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
            instances: [],
          },
        },
      },
    },
    editor: {
      type: 'plc-textual',
      meta: { name: 'main', path: '/pous/programs/main.st', language: 'st', pouType: 'program' },
      variable: { display: 'table' },
    },
    editors: [],
    tabs: [],
    selectedTab: 'main',
    history: {},
    fbdFlows: [],
    ladderFlows: [],
    files: {
      main: { type: 'program', saved: false, filePath: '/pous/programs/main.st' },
      Resource: { type: 'resource', saved: true, filePath: '/project.json' },
    },
    workspace: {
      editingState: 'unsaved',
      isDebuggerVisible: false,
      debuggerTargetIp: null,
      fbSelectedInstance: new Map(),
    },
    deviceDefinitions: {
      configuration: { ...defaultDeviceConfiguration, deviceBoard: 'Eurosonic_Gen2_8KW' },
      pinMapping: { pins: [] },
    },
    deviceAvailableOptions: {
      availableBoards: new Map([['Eurosonic_Gen2_8KW', { compiler: 'eurosonic-cli', coreVersion: '2.11.0' }]]),
    },
    libraries: { system: [], user: [] },
  } as unknown as RootState
  const compile = jest.fn().mockResolvedValue({ success: true, diagnostics: 'ok', repairable: false })
  const debug = jest.fn().mockResolvedValue({ success: true, sessionId: null })
  const operations = createMcpEditorOperations(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
    compile,
    debug,
  )
  const request = (action: McpAction): McpRequest => ({
    id: 'request',
    createdAt: Date.now(),
    action,
    capture: {
      projectPath: state.project.meta.path,
      context: buildPlcContext(state),
      target: debugTargetKey(state),
      debugger: debugObservations.snapshot(state),
    },
  })
  return { getState: () => state, compile, debug, operations, request }
}
const changes: McpAction = {
  operation: 'changes',
  snapshotId: 'snapshot',
  reply: {
    message: 'Change',
    instances: [],
    changes: [
      {
        operation: 'update',
        name: 'main',
        kind: 'program',
        language: 'st',
        returnType: '',
        documentation: '',
        declarations: '',
        body: '(* updated *)',
      },
    ],
  },
}

test('MCP edits and undo use the shared transaction without saving or invoking compiler/debugger', async () => {
  const f = fixture(),
    before = JSON.stringify(f.getState())
  await f.operations.execute(f.request(changes), () => true)
  expect(f.operations.undoId()).toBe('request')
  await f.operations.execute(f.request({ operation: 'undo', snapshotId: 'new' }), () => true)
  expect(JSON.stringify(f.getState())).toBe(before)
  expect(f.compile).not.toHaveBeenCalled()
  expect(f.debug).not.toHaveBeenCalled()
})
test.each(['cancel', 'source', 'target', 'debugger'])(
  'MCP rejects %s changes without editing or compiling',
  async (mode) => {
    const f = fixture(),
      request = f.request(changes)
    if (mode === 'source') f.getState().project.data.pous[0].data.documentation = 'manual work'
    if (mode === 'target') f.getState().deviceDefinitions.temporaryDhcpIp = '192.0.2.2'
    if (mode === 'debugger') f.getState().workspace.plcOperationsDebuggerActive = true
    const before = JSON.stringify(f.getState())
    await expect(f.operations.execute(request, () => mode !== 'cancel')).rejects.toThrow()
    expect(JSON.stringify(f.getState())).toBe(before)
    expect(f.compile).not.toHaveBeenCalled()
    expect(f.debug).not.toHaveBeenCalled()
  },
)
test('late compile results are discarded after cancellation, and compilation does not apply changes', async () => {
  const f = fixture(),
    before = JSON.stringify(f.getState())
  const request = f.request({ operation: 'compile', snapshotId: 'snapshot' })
  let current = true
  f.compile.mockImplementationOnce(() => {
    current = false
    return Promise.resolve({ success: true })
  })
  await expect(f.operations.execute(request, () => current)).rejects.toThrow('cancelled')
  expect(f.compile).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(f.getState())).toBe(before)
  expect(f.debug).not.toHaveBeenCalled()
})
test('debug commands never invoke compilation, and later manual work blocks MCP undo', async () => {
  const f = fixture()
  await f.operations.execute(
    f.request({
      operation: 'debug',
      snapshotId: 'snapshot',
      command: { operation: 'connect', variables: [], statementId: 0 },
    }),
    () => true,
  )
  expect(f.debug).toHaveBeenCalledTimes(1)
  expect(f.compile).not.toHaveBeenCalled()
  await f.operations.execute(f.request(changes), () => true)
  f.getState().project.data.pous[0].data.documentation = 'later'
  await expect(f.operations.execute(f.request({ operation: 'undo', snapshotId: 'new' }), () => true)).rejects.toThrow(
    'edited or saved',
  )
})
