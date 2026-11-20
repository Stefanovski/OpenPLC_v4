import { CodexState, initialCodexState } from '../../types/IPC/codex'
import { createCodexEditDispatcher } from './codex-direct-edits'

const state = (): CodexState => ({
  ...initialCodexState(),
  connection: 'connected',
  account: { type: 'chatgpt' },
  projectPath: 'C:/p',
  messages: [
    {
      id: 'reply',
      role: 'assistant',
      text: 'edit',
      applyRequestId: 'request',
      proposal: { base: { projectPath: 'C:/p', snapshot: '{}' }, reply: { message: '', changes: [], instances: [] } },
    },
  ],
})

test('dispatches a completed locally requested edit once, never during streaming', () => {
  const dispatcher = createCodexEditDispatcher()
  dispatcher.arm('request', 'C:/p')
  expect(dispatcher.take({ ...state(), busy: true })).toBeNull()
  expect(dispatcher.take({ ...state(), operationPending: true })).toBeNull()
  expect(dispatcher.take(state())?.id).toBe('reply')
  expect(dispatcher.take(state())).toBeNull()
})

test.each([
  'replay',
  'cancel',
  'different-request',
  'project',
  'base',
  'error',
  'disconnect',
  'signout',
  'scratch',
  'build',
  'no-edit',
])('does not apply %s', (mode) => {
  const dispatcher = createCodexEditDispatcher(),
    next = state()
  if (mode !== 'replay') dispatcher.arm(mode === 'different-request' ? 'new' : 'request', 'C:/p')
  if (mode === 'cancel') dispatcher.clear()
  if (mode === 'project') next.projectPath = 'C:/other'
  if (mode === 'base') next.messages[0].proposal!.base.projectPath = 'C:/other'
  if (mode === 'error') next.error = 'failed'
  if (mode === 'disconnect') next.connection = 'disconnected'
  if (mode === 'signout') next.account = null
  if (mode === 'scratch') next.messages[0].scratchOnly = true
  if (mode === 'build')
    next.messages[0].buildAction = { requestId: 'build', model: 'test', base: next.messages[0].proposal!.base }
  if (mode === 'no-edit') delete next.messages[0].proposal
  expect(dispatcher.take(next)).toBeNull()
})
