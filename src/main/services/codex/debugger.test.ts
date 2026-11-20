import type { CodexDebugExecute } from '../../../types/IPC/codex-debug-control'
import type { IecDebugMetadata } from '../../../types/PLC/iec-debug'
import { CodexDebugger } from './debugger'

const request = (): CodexDebugExecute => ({
  projectPath: 'C:/fixture',
  board: 'Eurosonic_Gen2_8KW',
  host: '192.0.2.1',
  sessionId: null,
  command: { operation: 'connect', variables: [], statementId: 0 },
  confirmExecution: false,
  data: { pous: [], dataTypes: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
})
function fixture() {
  const source = {
    identity: 'identity',
    md5: 'a'.repeat(32),
    metadata: {
      format: 'eurosonic-plc-debug',
      version: 1,
      id_algorithm: 'fnv1a32',
      build_id: 'build',
      pous: [{ id: 1, name: 'main' }],
      statements: [{ id: 10, pou_id: 1, line: 2 }],
      instances: [],
      variables: [{ id: 3, type_code: 7, type: 'UDINT', path: 'CONFIG0.RES0.INSTANCE0.BLINK1.COUNTER' }],
    } as unknown as IecDebugMetadata,
  }
  const status = {
    state: 1,
    currentStatementId: 10,
    currentPouId: 1,
    currentInstanceId: 1,
    breakpointCount: 0,
    breakpointCapacity: 32,
    pointCount: 8n,
    haltCount: 2n,
  }
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    getMd5Hash: jest.fn().mockResolvedValue(source.md5),
    getIecDebugCapabilities: jest.fn().mockResolvedValue(255),
    getIecDebugStatus: jest.fn().mockImplementation(() => Promise.resolve({ ...status })),
    getIecDebugCallStack: jest.fn().mockResolvedValue([{ pouId: 1, instanceId: 1, statementId: 10 }]),
    readIecDebugVariable: jest.fn().mockResolvedValue({ forced: false, type: 7, value: Buffer.from([42, 0, 0, 0]) }),
    setIecDebugBreakpoint: jest.fn().mockResolvedValue(undefined),
    clearIecDebugBreakpoint: jest.fn().mockResolvedValue(undefined),
    continueIecDebug: jest.fn().mockResolvedValue(undefined),
    stepIntoIecDebug: jest.fn().mockResolvedValue(undefined),
    stepOverIecDebug: jest.fn().mockResolvedValue(undefined),
    stepOutIecDebug: jest.fn().mockResolvedValue(undefined),
  }
  const load = jest.fn().mockImplementation(() => Promise.resolve(structuredClone(source)))
  const makeClient = jest.fn(() => client)
  const service = new CodexDebugger(load, makeClient)
  const writes = () =>
    [
      client.setIecDebugBreakpoint,
      client.clearIecDebugBreakpoint,
      client.continueIecDebug,
      client.stepIntoIecDebug,
      client.stepOverIecDebug,
      client.stepOutIecDebug,
    ].reduce((n, f) => n + f.mock.calls.length, 0)
  const connect = async () => ({ ...request(), sessionId: (await service.execute(request())).sessionId })
  return { source, status, client, load, makeClient, service, writes, connect }
}
test('attach reads verified status/values/stack without execution and close never clears or resumes', async () => {
  const f = fixture()
  const result = await f.service.execute(request())
  expect(result).toMatchObject({
    success: true,
    sourceMatch: 'verified',
    values: [{ value: '42' }],
    status: { haltCount: '2' },
    stack: [{ statementId: 10 }],
  })
  expect(f.makeClient).toHaveBeenCalledWith('192.0.2.1')
  expect(f.client.readIecDebugVariable).toHaveBeenCalledWith(3, 7)
  f.service.close()
  expect(f.writes()).toBe(0)
  expect(f.client.disconnect).toHaveBeenCalledTimes(1)
  expect(f.service.active()).toBe(false)
})
test.each(['set-breakpoint', 'clear-breakpoint', 'continue', 'step-into', 'step-over', 'step-out'] as const)(
  '%s requires concrete confirmation and uses only the requested execution operation',
  async (operation) => {
    const f = fixture(),
      r = await f.connect()
    r.command = { operation, variables: ['Blink1.Counter'], statementId: 10 }
    await expect(f.service.execute(r)).rejects.toThrow('confirmation')
    expect(f.writes()).toBe(0)
    expect((await f.service.execute({ ...r, confirmExecution: true })).success).toBe(true)
    expect(f.writes()).toBe(1)
    f.service.close()
    expect(f.writes()).toBe(1)
  },
)
test.each(['md5', 'identity', 'target', 'session', 'variable', 'statement', 'running', 'capability'])(
  'refuses %s mismatch before an execution write',
  async (mode) => {
    const f = fixture(),
      r = await f.connect()
    r.command = { operation: 'step-over', variables: [], statementId: 10 }
    r.confirmExecution = true
    if (mode === 'md5') f.client.getMd5Hash.mockResolvedValue('b'.repeat(32))
    if (mode === 'identity') f.source.identity = 'changed'
    if (mode === 'target') r.host = '192.0.2.2'
    if (mode === 'session') r.sessionId = '00000000-0000-4000-8000-000000000000'
    if (mode === 'variable') {
      f.source.metadata.variables.push({ ...f.source.metadata.variables[0], path: 'OTHER.BLINK1.COUNTER' })
      r.command.variables = ['Blink1.Counter']
    }
    if (mode === 'statement') {
      r.command.operation = 'set-breakpoint'
      r.command.statementId = 999
    }
    if (mode === 'running') f.status.state = 0
    if (mode === 'capability') f.client.getIecDebugCapabilities.mockResolvedValue(4)
    expect((await f.service.execute(r)).success).toBe(false)
    expect(f.writes()).toBe(0)
    expect(f.service.active()).toBe(false)
  },
)
test.each(['load', 'connect', 'md5', 'status'])('cancellation during %s prevents all later commands', async (phase) => {
  const f = fixture()
  const r = phase === 'connect' ? request() : await f.connect()
  if (phase !== 'connect') {
    r.command.operation = 'step-into'
    r.confirmExecution = true
  }
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const fn =
    phase === 'load'
      ? f.load
      : phase === 'connect'
        ? f.client.connect
        : phase === 'md5'
          ? f.client.getMd5Hash
          : f.client.getIecDebugStatus
  fn.mockImplementationOnce(async () => {
    await gate
    return phase === 'load' ? f.source : phase === 'md5' ? f.source.md5 : phase === 'status' ? f.status : undefined
  })
  const pending = f.service.execute(r)
  await new Promise<void>((resolve) => setImmediate(resolve))
  f.service.close()
  release()
  expect((await pending).success).toBe(false)
  expect(f.writes()).toBe(0)
})
test('missing artifacts do not connect, and debug commands never offer compile/upload/write/force', async () => {
  const f = fixture()
  f.load.mockRejectedValue(new Error('Missing artifact'))
  expect((await f.service.execute(request())).error).toContain('Missing artifact')
  expect(f.makeClient).not.toHaveBeenCalled()
  for (const operation of ['compile', 'download', 'force', 'write', 'run', 'stop'])
    await expect(f.service.execute({ ...request(), command: { ...request().command, operation } })).rejects.toThrow()
})
test('discard stack from a different halt and report the latest status', async () => {
  const f = fixture()
  f.client.getIecDebugStatus
    .mockResolvedValueOnce(f.status)
    .mockResolvedValueOnce(f.status)
    .mockResolvedValueOnce({ ...f.status, state: 0, haltCount: 3n })
  expect(await f.service.execute(request())).toMatchObject({
    success: true,
    stack: [],
    status: { state: 0, haltCount: '3' },
  })
})
