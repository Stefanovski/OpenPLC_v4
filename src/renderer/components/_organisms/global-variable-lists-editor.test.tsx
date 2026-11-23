/** @jest-environment jsdom */
import type { PLCGlobalVariableList } from '@root/types/PLC/open-plc'
import { fireEvent, render, screen } from '@testing-library/react'

import { gvlFixture } from '../../../../scripts/eurosonic/fixtures/gvl'
import { GlobalVariableListsEditor } from './global-variable-lists-editor'

const mockDirty = jest.fn()
const mockSnapshot = jest.fn()
const mockState = {
  project: { data: gvlFixture() },
  workspace: {
    isDebuggerVisible: false,
    plcOperationsDebuggerActive: false,
    debuggerTargetIp: '',
    editingState: '',
    systemConfigs: { shouldUseDarkMode: false },
  },
  projectActions: {
    setGlobalVariableLists: jest.fn((lists: PLCGlobalVariableList[]) => {
      mockState.project.data.globalVariableLists = lists
    }),
  },
  snapshotActions: { addSnapshot: mockSnapshot },
}
jest.mock('../../store', () => ({ useOpenPLCStore: () => mockState }))
jest.mock('../../hooks', () => ({ sharedSelectors: { useHandleFileAndWorkspaceSavedState: () => mockDirty } }))
jest.mock('./variables-code-editor', () => ({
  VariablesCodeEditor: ({
    code,
    onCodeChange,
    readOnly,
  }: {
    code: string
    onCodeChange: (value: string) => void
    readOnly: boolean
  }) => (
    <textarea
      aria-label='Declarations'
      value={code}
      readOnly={readOnly}
      onChange={(e) => onCodeChange(e.target.value)}
    />
  ),
}))

beforeEach(() => {
  global.structuredClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  jest.clearAllMocks()
  mockState.project.data = gvlFixture()
  Object.assign(mockState.workspace, {
    isDebuggerVisible: false,
    plcOperationsDebuggerActive: false,
    debuggerTargetIp: '',
    editingState: '',
  })
})

test('table edits create resource history and dirty state; switching views does not rewrite text', () => {
  const view = render(<GlobalVariableListsEditor selectedName='GVL_State' />)
  const input = screen.getByLabelText('initialValue GVL_State.Count')
  fireEvent.change(input, { target: { value: '55' } })
  // Menu and native Ctrl+S can save while this cell still has focus.
  expect(mockState.project.data.globalVariableLists![1].variables[1].initialValue).toBe('55')
  fireEvent.blur(input)
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  expect(mockState.project.data.globalVariableLists![1].variables[1]).toMatchObject({
    initialValue: '55',
    retain: true,
  })
  expect(mockSnapshot).toHaveBeenCalledWith('resource')
  expect(mockDirty).toHaveBeenCalledWith('Resource')
  const calls = mockSnapshot.mock.calls.length
  fireEvent.click(screen.getByText('Code', { exact: true }))
  fireEvent.click(screen.getByText('Table', { exact: true }))
  expect(mockSnapshot).toHaveBeenCalledTimes(calls)
})

test('incomplete typing remains editable, is stored immediately, and undo/redo refresh the cell', () => {
  const view = render(<GlobalVariableListsEditor selectedName='GVL_State' />)
  const before = structuredClone(mockState.project.data)
  fireEvent.change(screen.getByLabelText('type GVL_State.Count'), { target: { value: 'U' } })
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  expect(screen.getByLabelText<HTMLInputElement>('type GVL_State.Count').value).toBe('U')
  expect(mockState.project.data.globalVariableLists![1].variablesText).toContain('Count : U')
  fireEvent.change(screen.getByLabelText('type GVL_State.Count'), { target: { value: 'UINT' } })
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  const after = structuredClone(mockState.project.data)
  mockState.project.data = before
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  expect(screen.getByLabelText<HTMLInputElement>('type GVL_State.Count').value).toBe('UDINT')
  mockState.project.data = after
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  expect(screen.getByLabelText<HTMLInputElement>('type GVL_State.Count').value).toBe('UINT')
})

test('duplicate selects copy, explains address clearing and leaves source untouched', () => {
  const select = jest.fn()
  const before = structuredClone(mockState.project.data.globalVariableLists![0])
  const view = render(<GlobalVariableListsEditor selectedName='GVL_IO' onSelect={select} />)
  fireEvent.click(screen.getByText('Duplicate list'))
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_IO_Copy' onSelect={select} />)
  expect(select).toHaveBeenCalledWith('GVL_IO_Copy')
  expect(screen.getByRole('status').textContent).toContain('IO addresses')
  expect(mockState.project.data.globalVariableLists![0]).toEqual(before)
  expect(mockState.project.data.globalVariableLists!.at(-1)!.variables.every((v) => !v.location)).toBe(true)
})

test('invalid table draft opens code view and remains after selecting another list', () => {
  const view = render(<GlobalVariableListsEditor selectedName='GVL_IO' />)
  fireEvent.click(screen.getByLabelText('Retain GVL_IO.Lamp'))
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_IO' />)
  expect(screen.getByRole('alert').textContent).toContain('draft is preserved')
  expect(screen.getByLabelText<HTMLTextAreaElement>('Declarations').value).toContain('VAR_GLOBAL RETAIN')
  const text = mockState.project.data.globalVariableLists![0].variablesText
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_State' />)
  view.rerender(<GlobalVariableListsEditor selectedName='GVL_IO' />)
  expect(screen.getByLabelText<HTMLTextAreaElement>('Declarations').value).toBe(text)
})

test.each(['isDebuggerVisible', 'plcOperationsDebuggerActive', 'debuggerTargetIp', 'editingState'] as const)(
  'editing is locked for %s',
  (flag) => {
    Object.assign(mockState.workspace, {
      [flag]: flag === 'editingState' ? 'save-request' : flag === 'debuggerTargetIp' ? '192.0.2.1' : true,
    })
    render(<GlobalVariableListsEditor />)
    expect(screen.getByLabelText<HTMLInputElement>('location GVL_IO.Lamp').disabled).toBe(true)
    fireEvent.click(screen.getByText('Duplicate list'))
    fireEvent.click(screen.getByText('Add variable'))
    expect(mockSnapshot).not.toHaveBeenCalled()
  },
)
