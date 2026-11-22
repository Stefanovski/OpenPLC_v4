/** @jest-environment jsdom */
import { emptyMcpState, McpRequest, McpState } from '@root/types/IPC/mcp'
import { defaultPlcAiSettings } from '@root/types/plc-operations/ai-settings'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { plcAiSettingsStore, updatePlcAiSettings } from '../../operations/ai-settings'
import { WorkspaceMcpPanel } from './mcp-panel'
import { PlcAiSettings } from './plc-ai-settings'

const mockState = {
  project: { meta: { path: '/project' } },
  deviceDefinitions: {
    configuration: { communicationConfiguration: { communicationPreferences: { enabledDHCP: false } } },
  },
  deviceActions: { setTemporaryDhcpIp: jest.fn() },
}
const mockExecute = jest.fn()
const mockGuard = jest.fn()
const mockClose = jest.fn()
const mockUndo = jest.fn()
jest.mock('../../store', () => ({
  useOpenPLCStore: (select: (state: typeof mockState) => unknown) => select(mockState),
  openPLCStoreBase: { getState: () => mockState, setState: jest.fn() },
}))
jest.mock('../../utils/mcp-operations', () => ({
  guardMcpRequest: (...args: unknown[]) => {
    mockGuard(...args)
  },
  createMcpEditorOperations: () => ({ execute: mockExecute, undoId: () => 'last-edit', undo: mockUndo }),
}))
jest.mock('../../operations/use-debugger', () => ({ usePlcDebugger: () => ({ close: mockClose }) }))
jest.mock('../../operations/context', () => ({ buildPlcContext: jest.fn() }))
jest.mock('../../operations/debug-observations', () => ({ debugObservations: { snapshot: jest.fn() } }))
jest.mock('../../operations/debug-target', () => ({
  debugTargetKey: () => 'target',
  debuggerTarget: () => '192.0.2.1',
}))
jest.mock('@root/types/plc-operations/context', () => ({
  parsePlcContext: () => ({ project: { name: 'Test', pous: [] } }),
}))
jest.mock('../_features/[app]/toast/use-toast', () => ({ toast: jest.fn() }))
jest.mock('../_features/[app]/toast', () => ({ ToastAction: () => null }))
jest.mock('../_molecules/modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
  ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
let state: McpState
let receive: (state: McpState) => void
const bridge = {
  mcpState: jest.fn(),
  mcpConfigure: jest.fn(),
  mcpClaim: jest.fn(),
  mcpComplete: jest.fn(),
  mcpCancel: jest.fn(),
  mcpStop: jest.fn(),
  onMcpState: jest.fn(),
  onMcpCapture: jest.fn(),
  mcpDebugClose: jest.fn(),
}
function publish(next: McpState) {
  state = next
  receive(next)
}
function incoming(operation = 'changes', status = 'queued', debugOperation = 'connect') {
  const request = {
    id: 'request-1',
    createdAt: Date.now(),
    action: {
      operation,
      snapshotId: 'snapshot',
      reply: { changes: [], instances: [], message: 'Edit' },
      command: { operation: debugOperation, variables: [], statementId: 0 },
    },
    capture: { projectPath: '/project', target: 'target', context: { snapshot: '{}' } },
  } as unknown as McpRequest
  publish({
    ...state,
    pending: request,
    results: [{ id: request.id, operation: request.action.operation, status: status as 'queued', detail: 'Pending' }],
  })
}
beforeEach(() => {
  jest.clearAllMocks()
  plcAiSettingsStore.setState({ projects: {} })
  state = { ...emptyMcpState, enabled: true }
  bridge.onMcpState.mockImplementation((handler: (state: McpState) => void) => {
    receive = handler
    return jest.fn()
  })
  bridge.onMcpCapture.mockReturnValue(jest.fn())
  bridge.mcpState.mockImplementation(() => Promise.resolve(state))
  bridge.mcpConfigure.mockResolvedValue(undefined)
  bridge.mcpStop.mockResolvedValue(undefined)
  bridge.mcpCancel.mockResolvedValue(undefined)
  bridge.mcpClaim.mockImplementation(() => {
    const request = state.pending
    publish({ ...state, results: state.results.map((r) => ({ ...r, status: 'executing' })) })
    return Promise.resolve(request)
  })
  bridge.mcpComplete.mockImplementation((_id: string, success: boolean, value: unknown) => {
    publish({
      ...state,
      pending: null,
      results: state.results.map((r) => ({ ...r, status: success ? 'completed' : 'failed', value })),
    })
    return Promise.resolve()
  })
  mockExecute.mockResolvedValue({ status: 'applied' })
  mockGuard.mockImplementation(() => {})
  Object.defineProperty(window, 'bridge', { configurable: true, value: bridge })
})
async function mount() {
  render(<WorkspaceMcpPanel />)
  await waitFor(() => expect(bridge.mcpConfigure).toHaveBeenCalled())
}
it('applies a request once with the panel closed and keeps local undo available', async () => {
  await mount()
  act(() => incoming())
  await waitFor(() => expect(bridge.mcpComplete).toHaveBeenCalledWith('request-1', true, { status: 'applied' }))
  expect(mockExecute).toHaveBeenCalledTimes(1)
  expect(bridge.mcpClaim).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByLabelText('Open MCP connections'))
  await act(async () => {
    fireEvent.click(screen.getByText('Undo last MCP change'))
    await Promise.resolve()
  })
  expect(mockUndo).toHaveBeenCalledTimes(1)
})
it('opens review automatically, does not reopen after dismissal, and applies only on approval', async () => {
  updatePlcAiSettings('/project', { directEdits: false })
  await mount()
  act(() => incoming('changes', 'review-required'))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(mockExecute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Close MCP panel'))
  act(() => publish({ ...state, results: [...state.results] }))
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByLabelText('Open MCP connections'))
  fireEvent.click(screen.getByText('Approve MCP request'))
  await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1))
})
it.each(['compile', 'debug'])('runs an explicit %s request without redundant confirmation', async (operation) => {
  await mount()
  act(() => incoming(operation))
  await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('execution/breakpoint commands always open review even in direct edit mode', async () => {
  await mount()
  act(() => incoming('debug', 'review-required', 'step-over'))
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(mockExecute).not.toHaveBeenCalled()
})
it('reports stale source as failure instead of leaving an invisible pending request', async () => {
  mockGuard.mockImplementation(() => {
    throw new Error('Source changed')
  })
  await mount()
  act(() => incoming())
  await waitFor(() => expect(bridge.mcpComplete).toHaveBeenCalledWith('request-1', false, { error: 'Source changed' }))
  expect(mockExecute).not.toHaveBeenCalled()
})
it('rechecks settings after asynchronous claim before any editor mutation', async () => {
  let claim!: (request: McpRequest) => void
  bridge.mcpClaim.mockImplementation(
    () =>
      new Promise((resolve) => {
        claim = resolve
      }),
  )
  await mount()
  act(() => incoming())
  await waitFor(() => expect(bridge.mcpClaim).toHaveBeenCalled())
  act(() => updatePlcAiSettings('/project', { proposeChanges: false }))
  await act(async () => {
    claim(state.pending!)
    await Promise.resolve()
  })
  await waitFor(() => expect(bridge.mcpComplete).toHaveBeenCalledWith('request-1', false, expect.anything()))
  expect(mockExecute).not.toHaveBeenCalled()
})
it('shares settings between both surfaces and isolates other projects', async () => {
  await mount()
  render(
    <div data-testid='sidebar-settings'>
      <PlcAiSettings projectPath='/project' />
    </div>,
  )
  fireEvent.click(screen.getByLabelText('Open MCP connections'))
  fireEvent.change(within(screen.getByTestId('sidebar-settings')).getByLabelText('Code changes'), {
    target: { value: 'review' },
  })
  expect(within(screen.getByRole('dialog')).getByLabelText<HTMLSelectElement>('Code changes').value).toBe('review')
  await waitFor(() =>
    expect(bridge.mcpConfigure).toHaveBeenLastCalledWith({ ...defaultPlcAiSettings, directEdits: false }),
  )
  expect(plcAiSettingsStore.getState().projects['/other']).toBeUndefined()
})
