import { initialCodexState } from '../../types/IPC/codex'
import { parseCodexDebugReply } from '../../types/IPC/codex-debug-control'
import { createCodexDebugDispatcher } from './codex-debug-control'

const action = {
  requestId: 'request1',
  model: 'model1',
  base: { projectPath: 'C:/project', snapshot: '{}' },
  command: { operation: 'connect' as const, variables: [], statementId: 0 },
}
const state = () => ({
  ...initialCodexState(),
  projectPath: 'C:/project',
  connection: 'connected' as const,
  account: { type: 'chatgpt' as const },
  messages: [{ id: 'a', role: 'assistant' as const, text: 'Attach', debugAction: action }],
})
test('only completed locally initiated commands dispatch once; replay and cancel are inert', () => {
  const d = createCodexDebugDispatcher()
  expect(d.take(state(), 'target')).toBeNull()
  d.arm('request1', 'C:/project', 'target')
  expect(d.take({ ...state(), busy: true }, 'target')).toBeNull()
  expect(d.take(state(), 'target')).toEqual({ action, target: 'target' })
  expect(d.take(state(), 'target')).toBeNull()
  d.arm('request1', 'C:/project', 'target')
  d.clear()
  expect(d.take(state(), 'target')).toBeNull()
})
test.each(['target', 'project', 'error', 'disconnect', 'signout', 'scratch'])('refuses %s changes', (mode) => {
  const d = createCodexDebugDispatcher()
  d.arm('request1', 'C:/project', 'target')
  const s = state()
  expect(
    d.take(
      {
        ...s,
        ...(mode === 'project' ? { projectPath: 'other' } : {}),
        ...(mode === 'error' ? { error: 'error' } : {}),
        ...(mode === 'disconnect' ? { connection: 'disconnected' as const } : {}),
        ...(mode === 'signout' ? { account: null } : {}),
        ...(mode === 'scratch' ? { messages: [{ ...s.messages[0], scratchOnly: true }] } : {}),
      },
      mode === 'target' ? 'other' : 'target',
    ),
  ).toBeNull()
})
test('schema separates debug/compile/edit replies and forbids unexposed commands', () => {
  const reply = { message: 'Connect', changes: [], instances: [], action: 'debug', debugCommand: action.command }
  expect(parseCodexDebugReply(JSON.stringify(reply)).action).toBe('debug')
  for (const changed of [
    { ...reply, action: 'none' },
    { ...reply, action: 'compile-and-fix' },
    { ...reply, debugCommand: null },
    { ...reply, debugCommand: { ...action.command, operation: 'download' } },
    { ...reply, debugCommand: { ...action.command, variables: Array(25).fill('x') } },
  ])
    expect(() => parseCodexDebugReply(JSON.stringify(changed))).toThrow()
})
