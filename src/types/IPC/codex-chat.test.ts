import { parseCodexChatReply } from './codex-chat'
import { parseCodexEditReply } from './codex-edits'

const reply = { message: 'Starting compilation', changes: [], instances: [], action: 'compile-and-fix' }
test('accepts a parameterless compile request or ordinary chat/edit reply', () => {
  expect(parseCodexChatReply(JSON.stringify(reply)).action).toBe('compile-and-fix')
  expect(parseCodexChatReply(JSON.stringify({ ...reply, action: 'none' })).action).toBe('none')
})
test.each([
  { ...reply, action: 'upload' },
  { ...reply, command: 'arbitrary' },
  { ...reply, path: 'C:/source' },
  { ...reply, instances: [{ name: 'new', task: 'task0', program: 'main' }] },
  {
    ...reply,
    changes: [
      {
        operation: 'update',
        name: 'main',
        kind: 'program',
        language: 'st',
        returnType: '',
        documentation: '',
        declarations: '',
        body: '',
      },
    ],
  },
  { message: 'Missing action', changes: [], instances: [] },
])('rejects malformed, unsupported or mixed edit/action replies: %j', (value) => {
  expect(() => parseCodexChatReply(JSON.stringify(value))).toThrow()
})
test('internal repair schema rejects actions, preventing recursive compile requests', () => {
  expect(() => parseCodexEditReply(JSON.stringify(reply))).toThrow()
})
