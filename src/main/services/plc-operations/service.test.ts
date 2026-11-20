import type { PlcDebugExecute } from '../../../types/plc-operations/debugger'
import { PlcOperationsService } from './service'

const input = (): PlcDebugExecute => ({
  projectPath: 'C:/project',
  board: 'Eurosonic_Gen2_8KW',
  host: '192.0.2.1',
  sessionId: null,
  command: { operation: 'connect', variables: [], statementId: 0 },
  confirmExecution: false,
  data: { pous: [], dataTypes: [], configuration: { resource: { globalVariables: [], tasks: [], instances: [] } } },
})
function fixture() {
  let generation = 0
  const build = {
    active: jest.fn(() => false),
    compile: jest.fn().mockResolvedValue({ success: true, diagnostics: 'ok', repairable: false }),
  }
  const debug = {
    active: jest.fn(() => false),
    generation: () => generation,
    close: jest.fn(() => {
      generation++
    }),
    execute: jest.fn().mockResolvedValue({ success: true, sessionId: null, host: '192.0.2.1', sampledAt: 0 }),
    context: jest.fn(() => null),
  }
  const boards = jest.fn().mockResolvedValue({ Eurosonic_Gen2_8KW: { compiler: 'eurosonic-cli' } })
  const service = new PlcOperationsService(build, debug, boards)
  service.selectProject('C:/project')
  return { service, build, debug, boards }
}
test('independent adapters share the same compiler/debugger exclusion and operation instance', async () => {
  const f = fixture()
  const providerA = { compile: (r: unknown) => f.service.compile(r) }
  const providerB = { debug: (r: unknown) => f.service.executeDebug(r) }
  await providerB.debug(input())
  expect(f.debug.execute).toHaveBeenCalledWith(input())
  expect(f.build.compile).not.toHaveBeenCalled()
  f.debug.active.mockReturnValue(true)
  expect(() => providerA.compile({})).toThrow('Disconnect')
  f.debug.active.mockReturnValue(false)
  await providerA.compile({})
  expect(f.build.compile).toHaveBeenCalledTimes(1)
  f.build.active.mockReturnValue(true)
  await expect(providerB.debug(input())).rejects.toThrow('compilation')
  expect(f.debug.execute).toHaveBeenCalledTimes(1)
})
test.each(['project', 'board', 'malformed'])('rejects %s before debug execution', async (mode) => {
  const f = fixture(),
    request = input()
  if (mode === 'project') request.projectPath = 'C:/other'
  if (mode === 'board') request.board = 'other'
  await expect(f.service.executeDebug(mode === 'malformed' ? {} : request)).rejects.toThrow()
  expect(f.debug.execute).not.toHaveBeenCalled()
  expect(f.build.compile).not.toHaveBeenCalled()
})
test.each(['project', 'close', 'compile'])(
  'revalidates %s changes across asynchronous board validation',
  async (mode) => {
    const f = fixture()
    let release: (value: object) => void = () => {}
    f.boards.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const running = f.service.executeDebug(input())
    if (mode === 'project') f.service.selectProject('C:/other')
    if (mode === 'close') f.service.closeDebugger()
    if (mode === 'compile') f.build.active.mockReturnValue(true)
    release({ Eurosonic_Gen2_8KW: { compiler: 'eurosonic-cli' } })
    await expect(running).rejects.toThrow()
    expect(f.debug.execute).not.toHaveBeenCalled()
  },
)
test('same project keeps the session; switching/disposal releases it without compiler work', () => {
  const f = fixture(),
    before = f.debug.close.mock.calls.length
  f.service.selectProject('C:/project')
  expect(f.debug.close).toHaveBeenCalledTimes(before)
  f.service.selectProject('C:/other')
  f.service.dispose()
  expect(f.debug.close).toHaveBeenCalledTimes(before + 2)
  expect(f.build.compile).not.toHaveBeenCalled()
})

test('providers cannot take over or close another debugger, including asynchronous source/board validation', async () => {
  const f = fixture()
  let release: (value: object) => void = () => {}
  f.boards.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const running = f.service.executeDebug(input(), 'first')
  const generation = f.debug.generation()
  f.service.closeDebugger('second')
  expect(f.debug.generation()).toBe(generation)
  await expect(f.service.executeDebug(input(), 'second')).rejects.toThrow('owns')
  expect(() => f.service.compile({})).toThrow('Disconnect')
  f.debug.active.mockReturnValue(true)
  release({ Eurosonic_Gen2_8KW: { compiler: 'eurosonic-cli' } })
  await running
  f.service.closeDebugger('second')
  expect(f.debug.generation()).toBe(generation)
  f.service.closeDebugger('first')
  expect(f.debug.generation()).toBe(generation + 1)
})

test('a cancelled native operation must settle before another provider can claim the debugger', async () => {
  const f = fixture()
  f.debug.active.mockReturnValue(true)
  await expect(f.service.executeDebug(input(), 'next')).rejects.toThrow('previous')
  expect(f.boards).not.toHaveBeenCalled()
  f.debug.active.mockReturnValue(false)
  await f.service.executeDebug(input(), 'next')
  expect(f.debug.execute).toHaveBeenCalledTimes(1)
})
