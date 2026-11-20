import { initialCodexState } from '../../types/IPC/codex'
import { createCodexBuildDispatcher } from './codex-chat-action'

const action = { requestId: 'request1', model: 'model1', base: { projectPath: 'C:/project', snapshot: '{}' } }
const state = () => ({
  ...initialCodexState(),
  projectPath: 'C:/project',
  connection: 'connected' as const,
  account: { type: 'chatgpt' as const },
  messages: [{ id: 'reply1', role: 'assistant' as const, text: 'Starting', buildAction: action }],
})

test('consumes a completed action only once for the locally initiated request', () => {
  const dispatcher = createCodexBuildDispatcher()
  dispatcher.arm('request1', 'C:/project')
  expect(dispatcher.take({ ...state(), busy: true })).toBeNull()
  expect(dispatcher.take({ ...state(), operationPending: true })).toBeNull()
  expect(dispatcher.take(state())).toEqual(action)
  expect(dispatcher.take(state())).toBeNull()
})
test('history replay, a fresh mount and cancellation never start compilation', () => {
  const dispatcher = createCodexBuildDispatcher()
  expect(dispatcher.take(state())).toBeNull()
  dispatcher.arm('request1', 'C:/project')
  dispatcher.clear()
  expect(dispatcher.take(state())).toBeNull()
  dispatcher.arm('newRequest', 'C:/project')
  expect(dispatcher.take(state())).toBeNull()
})
test.each(['project', 'error', 'disconnect', 'signout', 'foreignBase', 'scratch'])(
  'refuses unsafe dispatch: %s',
  (mode) => {
    const dispatcher = createCodexBuildDispatcher()
    dispatcher.arm('request1', 'C:/project')
    const value = state()
    if (mode === 'foreignBase')
      value.messages[0].buildAction = { ...action, base: { ...action.base, projectPath: 'C:/other' } }
    const next = {
      ...value,
      ...(mode === 'project' ? { projectPath: 'C:/other' } : {}),
      ...(mode === 'error' ? { error: 'failed' } : {}),
      ...(mode === 'disconnect' ? { connection: 'disconnected' as const } : {}),
      ...(mode === 'signout' ? { account: null } : {}),
      ...(mode === 'scratch' ? { messages: [{ ...value.messages[0], scratchOnly: true }] } : {}),
    }
    expect(dispatcher.take(next)).toBeNull()
  },
)
