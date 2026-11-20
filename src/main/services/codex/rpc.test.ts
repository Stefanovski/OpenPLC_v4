import { ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import { CodexRpc, safeError } from './rpc'

function fixture(timeout = 1000) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  })
  const writes: string[] = []
  child.stdin.on('data', (buffer: Buffer) => writes.push(buffer.toString()))
  const notify = jest.fn(),
    exit = jest.fn()
  const rpc = new CodexRpc(child as unknown as ChildProcessWithoutNullStreams, notify, exit, timeout)
  const respond = (value: unknown) => {
    child.stdout.write(JSON.stringify(value) + '\n')
  }
  return { child, writes, notify, exit, rpc, respond }
}

test('handles fragmented JSONL, interleaved notifications and out-of-order responses', async () => {
  const f = fixture()
  const first = f.rpc.request('one'),
    second = f.rpc.request('two')
  f.child.stdout.write('{"id":2,"res')
  f.child.stdout.write('ult":{"ok":true}}\n')
  f.respond({ method: 'notice', params: { value: 1 } })
  f.respond({ id: 999, result: {} })
  f.respond({ id: 1, result: 'done' })
  expect(await first).toBe('done')
  expect(await second).toEqual({ ok: true })
  expect(f.notify).toHaveBeenCalledWith('notice', { value: 1 })
  f.rpc.close()
})

test('denies execution/file permissions and rejects unsupported server tools', () => {
  const f = fixture()
  f.respond({ id: 'a', method: 'item/commandExecution/requestApproval' })
  f.respond({ id: 'b', method: 'item/fileChange/requestApproval' })
  f.respond({ id: 'c', method: 'item/permissions/requestApproval' })
  f.respond({ id: 'd', method: 'item/tool/call' })
  expect(f.writes.map((line) => JSON.parse(line) as unknown)).toEqual([
    { id: 'a', result: { decision: 'decline' } },
    { id: 'b', result: { decision: 'decline' } },
    { id: 'c', result: { permissions: {}, scope: 'turn' } },
    { id: 'd', error: { code: -32601, message: 'This OpenPLC client does not support this tool.' } },
  ])
  f.rpc.close()
})

test('timeout terminates the child and rejects all outstanding requests', async () => {
  jest.useFakeTimers()
  const f = fixture(50)
  const pending = expect(f.rpc.request('account/read')).rejects.toThrow('timed out')
  jest.advanceTimersByTime(51)
  await pending
  jest.advanceTimersByTime(1500)
  expect(f.child.kill).toHaveBeenCalledTimes(1)
  expect(f.exit).toHaveBeenCalledTimes(1)
  await expect(f.rpc.request('again')).rejects.toThrow('disconnected')
  jest.useRealTimers()
})

test('malformed stdout fails closed, rejects pending work, and never forwards stderr', async () => {
  const f = fixture()
  const pending = expect(f.rpc.request('initialize')).rejects.toThrow('Invalid Codex protocol')
  f.child.stderr.write('credentials must not be forwarded')
  f.child.stdout.write('not-json\n')
  await pending
  expect(f.notify).not.toHaveBeenCalled()
  expect(f.child.stdin.writableEnded).toBe(true)
})

test('RPC errors redact credential-like content', async () => {
  const f = fixture()
  const pending = f.rpc.request('account/read')
  f.respond({ id: 1, error: { message: 'Failed Bearer abc access_token=secret sk-12345' } })
  await expect(pending).rejects.toThrow('Failed [redacted] [redacted] [redacted]')
  expect(safeError(new Error('eyJheader.payload.signature'))).toBe('[redacted]')
  f.rpc.close()
})
