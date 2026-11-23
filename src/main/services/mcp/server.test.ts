import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { randomUUID } from 'crypto'
import { request as httpRequest } from 'http'

import type { McpCapture } from '../../../types/IPC/mcp'
import { defaultPlcAiSettings } from '../../../types/plc-operations/ai-settings'
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

test('shared settings authorize direct edits and explicit builds; debug execution still needs review', async () => {
  const { broker } = fixture()
  broker.configure(defaultPlcAiSettings)
  const context = await broker.context()
  expect(context.settings).toEqual(defaultPlcAiSettings)
  expect(context.debugger).toBeNull()
  expect(context.capabilities.editMode).toBe('direct-with-undo')
  const queued = broker.submit({
    operation: 'changes',
    snapshotId: context.snapshotId,
    reply: { message: 'edit', changes: [], instances: [] },
  })
  expect(queued.status).toBe('queued')
  const completed = broker.waitForResult(queued.id)
  broker.claim(queued.id)
  broker.complete(queued.id, true, { status: 'applied' })
  expect((await completed).status).toBe('completed')
  const step = broker.submit({
    operation: 'debug',
    snapshotId: (await broker.context()).snapshotId,
    command: { operation: 'step-over', variables: [], statementId: 0 },
  })
  expect(step.status).toBe('review-required')
  expect((await broker.waitForResult(step.id)).detail).toContain('do not repeatedly poll')
})

test('changing shared permissions reclassifies or cancels pending work and hides passive samples', async () => {
  const { broker } = fixture()
  broker.configure({ ...defaultPlcAiSettings, directEdits: false, includeDebugger: true })
  expect((await broker.context()).debugger).not.toBeNull()
  const queued = broker.submit({ operation: 'undo', snapshotId: (await broker.context()).snapshotId })
  expect(queued.status).toBe('review-required')
  broker.configure(defaultPlcAiSettings)
  expect(broker.result(queued.id).status).toBe('queued')
  broker.configure({ ...defaultPlcAiSettings, directEdits: false })
  expect(broker.result(queued.id).status).toBe('review-required')
  broker.configure({ ...defaultPlcAiSettings, proposeChanges: false })
  expect(broker.result(queued.id).status).toBe('cancelled')
  expect(() => broker.claim(queued.id)).toThrow()
  const context = await broker.context()
  expect(() => broker.submit({ operation: 'undo', snapshotId: context.snapshotId })).toThrow('editing is disabled')
  broker.configure({ ...defaultPlcAiSettings, activeDebugger: false })
  expect(() =>
    broker.submit({
      operation: 'debug',
      snapshotId: context.snapshotId,
      command: { operation: 'connect', variables: [], statementId: 0 },
    }),
  ).toThrow('debugger commands are disabled')
  broker.configure({ ...defaultPlcAiSettings, includeContext: false })
  await expect(broker.context()).rejects.toThrow('Project access is disabled')
})

test('bounded waits report running work and shutdown without hanging', async () => {
  jest.useFakeTimers()
  const { broker } = fixture()
  broker.configure(defaultPlcAiSettings)
  const result = broker.submit({ operation: 'compile', snapshotId: (await broker.context()).snapshotId })
  broker.claim(result.id)
  const waiting = broker.waitForResult(result.id)
  jest.advanceTimersByTime(1500)
  expect((await waiting).status).toBe('executing')
  const shutdown = broker.waitForResult(result.id)
  broker.reset()
  expect((await shutdown).status).toBe('cancelled')
})

test('real SDK tool call returns completed directly after the host transaction', async () => {
  const { broker, notify } = fixture()
  broker.configure(defaultPlcAiSettings)
  notify.mockImplementation(() => {
    const pending = broker.state().pending
    if (pending && broker.result(pending.id).status === 'queued')
      setTimeout(() => {
        broker.claim(pending.id)
        broker.complete(pending.id, true, { status: 'applied' })
      }, 0)
  })
  const listener = new LocalMcpServer(broker)
  cleanups.push(() => listener.stop())
  const { endpoint, token } = await listener.start()
  const client = new Client({ name: 'direct-client', version: '1.0.0' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    const snapshotId = (await broker.context()).snapshotId
    const response = await client.callTool({
      name: 'openplc_apply_changes',
      arguments: {
        snapshotId,
        reply: { message: 'edit', changes: [], instances: [] },
      },
    })
    expect(JSON.parse((response.content as Array<{ text: string }>)[0].text)).toMatchObject({
      status: 'completed',
      value: { status: 'applied' },
    })
    expect(broker.state().pending).toBeNull()
  } finally {
    await client.close()
  }
}, 20000)
