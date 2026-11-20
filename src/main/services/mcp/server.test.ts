import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { randomUUID } from 'crypto'
import { request as httpRequest } from 'http'

import type { McpCapture } from '../../../types/IPC/mcp'
import { McpBroker } from './broker'
import { LocalMcpServer } from './server'

function capture(): McpCapture {
  return {
    projectPath: 'C:/project',
    target: 'target',
    context: {
      projectPath: 'C:/project',
      snapshot: JSON.stringify({
        version: 1,
        capturedAt: Date.now(),
        project: {
          name: 'Unsaved test',
          activeEditor: 'main',
          editingState: 'unsaved',
          pous: [],
          dataTypes: [],
          resource: { globals: { source: 'table', variables: [] }, tasks: [], instances: [] },
        },
        device: { board: 'Eurosonic_Gen2_8KW', compiler: 'eurosonic-cli', coreVersion: '2.11.0', pinMapping: [] },
        io: { configuredHost: '192.0.2.1', expected: null, observation: null },
      }),
    },
    debugger: {
      version: 1,
      capturedAt: Date.now(),
      debuggerActive: false,
      sessionMatches: false,
      target: null,
      sourceMatch: 'unverified',
      unsavedChanges: true,
      localBuildId: null,
      status: null,
      callStack: null,
      variables: [],
      omittedVariables: 0,
      cacheLimited: false,
      selectedInstances: [],
    },
  }
}
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((f) => f())
  jest.useRealTimers()
})
function fixture() {
  const read = jest.fn(() => Promise.resolve(capture())),
    notify = jest.fn()
  const broker = new McpBroker(read, notify)
  broker.activate('C:/project')
  cleanups.push(() => broker.reset())
  return { broker, read, notify }
}

test('tools only queue approval; snapshots are consumed and claims/results cannot replay', async () => {
  const { broker } = fixture()
  const context = await broker.context()
  expect(context.context.generatorGuidance?.length).toBeGreaterThan(0)
  expect(context.context.io.status).toBe('not-read')
  const result = broker.submit({ operation: 'compile', snapshotId: context.snapshotId })
  expect(result.status).toBe('review-required')
  expect(() => broker.assertExecuting(result.id, 'compile')).toThrow()
  broker.claim(result.id)
  expect(() => broker.claim(result.id)).toThrow()
  expect(() => broker.assertExecuting(result.id, 'debug')).toThrow()
  broker.complete(result.id, true, { diagnostics: 'ok' })
  broker.complete(result.id, false, 'replayed')
  expect(broker.result(result.id)).toMatchObject({ status: 'completed', value: { diagnostics: 'ok' } })
  expect(() => broker.submit({ operation: 'compile', snapshotId: context.snapshotId })).toThrow('consumed')
})
test('cancel, expiry, reset, arbitrary approval fields and parallel requests are rejected', async () => {
  jest.useFakeTimers()
  const { broker } = fixture()
  const first = await broker.context(),
    second = await broker.context()
  expect(() => broker.submit({ operation: 'compile', snapshotId: first.snapshotId, approved: true })).toThrow()
  const queued = broker.submit({ operation: 'compile', snapshotId: first.snapshotId })
  expect(() => broker.submit({ operation: 'compile', snapshotId: second.snapshotId })).toThrow('Another')
  jest.advanceTimersByTime(120001)
  expect(broker.result(queued.id).status).toBe('cancelled')
  expect(() => broker.claim(queued.id)).toThrow()
  expect(() => broker.submit({ operation: 'compile', snapshotId: second.snapshotId })).toThrow('expired')
  const next = broker.submit({ operation: 'undo', snapshotId: (await broker.context()).snapshotId })
  broker.claim(next.id)
  broker.cancel(next.id)
  broker.complete(next.id, true, 'late')
  expect(broker.result(next.id).status).toBe('cancelled')
  broker.reset()
  expect(() => broker.result(next.id)).toThrow('Unknown')
  await expect(broker.context()).rejects.toThrow('disabled')
})
test('a context captured across project changes or shutdown cannot authorize actions', async () => {
  const { broker, read } = fixture()
  let release: (value: McpCapture) => void = () => {}
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const pending = broker.context()
  broker.activate('C:/other')
  release(capture())
  await expect(pending).rejects.toThrow('changed')
})
test('real SDK HTTP client can discover tools, read context and queue/poll/cancel without execution', async () => {
  const { broker } = fixture(),
    listener = new LocalMcpServer(broker)
  const { endpoint, token } = await listener.start()
  cleanups.push(() => listener.stop())
  const client = new Client({ name: 'independent-test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['openplc_get_context', 'openplc_apply_changes', 'openplc_compile', 'openplc_debug']),
    )
    expect(tools.some((t) => /download|shell|save|force/.test(t.name))).toBe(false)
    const context = await client.callTool({ name: 'openplc_get_context', arguments: {} })
    const content = context.content as Array<{ text: string }>
    const snapshotId = (JSON.parse(content[0].text) as { snapshotId: string }).snapshotId
    const queued = await client.callTool({ name: 'openplc_compile', arguments: { snapshotId } })
    const request = JSON.parse((queued.content as Array<{ text: string }>)[0].text) as { id: string; status: string }
    expect(request.status).toBe('review-required')
    expect(broker.state().pending?.id).toBe(request.id)
    await client.callTool({ name: 'openplc_cancel', arguments: { requestId: request.id } })
    expect(broker.result(request.id).status).toBe('cancelled')
    const invalid = await client.callTool({
      name: 'openplc_debug',
      arguments: { snapshotId: randomUUID(), command: { operation: 'force' } },
    })
    expect(invalid.isError).toBe(true)
  } finally {
    await client.close()
  }
}, 20000)
test('HTTP rejects missing credentials, browser origins, DNS rebinding hosts, oversized/malformed input and old tokens', async () => {
  const { broker } = fixture(),
    listener = new LocalMcpServer(broker)
  cleanups.push(() => listener.stop())
  const { endpoint, token } = await listener.start()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  expect((await fetch(endpoint)).status).toBe(401)
  expect((await fetch(endpoint, { headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(403)
  const rebound = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(endpoint, { headers: { ...headers, Host: 'evil.test' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  expect(rebound).toBe(403)
  expect((await fetch(endpoint, { headers })).status).toBe(405)
  expect((await fetch(endpoint, { method: 'POST', headers, body: 'invalid' })).status).toBe(400)
  expect((await fetch(endpoint, { method: 'POST', headers, body: '[]' })).status).toBe(400)
  expect((await fetch(endpoint, { method: 'POST', headers, body: 'x'.repeat(200001) })).status).toBe(413)
  listener.stop()
  const restarted = await listener.start()
  expect(restarted.token).not.toBe(token)
  expect((await fetch(restarted.endpoint, { headers })).status).toBe(401)
}, 20000)
