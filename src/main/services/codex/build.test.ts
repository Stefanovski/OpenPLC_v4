import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { PLCProjectData } from '../../../types/PLC/open-plc'
import type { CompilerModule } from '../../modules/compiler/compiler-module'
import { CodexBuildService } from './build'

const mockCompile = () =>
  jest.fn<ReturnType<CompilerModule['compileProgram']>, Parameters<CompilerModule['compileProgram']>>()

const request = () => ({
  board: 'Eurosonic_Gen2_8KW',
  data: {
    pous: [
      {
        type: 'function-block',
        data: {
          name: 'Blink',
          language: 'cpp',
          documentation: '',
          variables: [],
          body: { language: 'cpp', value: 'void setup() {}\nvoid loop() {}' },
        },
      },
    ],
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  },
})
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-build-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
async function fixture(
  compileProgram = mockCompile().mockImplementation((_args, port) => {
    port.postMessage({ message: 'BUILD FINISHED SUCCESSFULLY.' })
    port.postMessage({ compilationSucceeded: true })
    return Promise.resolve()
  }),
) {
  const halsFilePath = join(root, 'hals.json')
  await writeFile(halsFilePath, JSON.stringify({ Eurosonic_Gen2_8KW: { compiler: 'eurosonic-cli' } }))
  const compiler = { halsFilePath, compileProgram } as unknown as CompilerModule
  return { service: new CodexBuildService(compiler, join(root, 'scratch')), compileProgram }
}

test('uses isolated directory, forces compile-only, preprocesses C++, cleans up and never touches source', async () => {
  const { service, compileProgram } = await fixture()
  const source = join(root, 'project.json')
  await writeFile(source, 'unsaved source sentinel')
  const input = request(),
    before = structuredClone(input)
  expect((await service.compile(input)).success).toBe(true)
  const [args, , bridge] = compileProgram.mock.calls[0]
  expect(args[0]).toContain(join(root, 'scratch', 'build-'))
  expect(args.slice(1, 4)).toEqual(['Eurosonic_Gen2_8KW', null, true])
  expect(args.slice(5)).toEqual([null, null])
  const data = args[4] as PLCProjectData & { originalCppPous: { code: string }[] }
  expect(data.originalCppPous[0].code).toContain('void loop()')
  expect(data.pous[0].data.body.language).toBe('st')
  await expect(bridge.makeRuntimeApiRequest('', '', '')).rejects.toThrow('disabled')
  expect(input).toEqual(before)
  expect(await readFile(source, 'utf8')).toBe('unsaved source sentinel')
  expect(await readdir(join(root, 'scratch'))).toEqual([])
})

test('requires final compiler success including binary validation, not an intermediate build log', async () => {
  const { service } = await fixture(
    mockCompile().mockImplementation((_args, port) => {
      port.postMessage({ message: 'BUILD FINISHED SUCCESSFULLY.' })
      port.postMessage({ message: 'OPEN_PLC.bin too large' })
      port.close()
      return Promise.resolve()
    }),
  )
  expect((await service.compile(request())).success).toBe(false)
})

test('bounds compiler diagnostics and classifies source errors', async () => {
  const { service } = await fixture(
    mockCompile().mockImplementation((_args, port) => {
      port.postMessage({ message: 'x'.repeat(50000) + '\nprogram.st:12: error: invalid expression' })
      return Promise.resolve()
    }),
  )
  const result = await service.compile(request())
  expect(result.repairable).toBe(true)
  expect(result.diagnostics.length).toBeLessThanOrEqual(24000)
})

test('does not misclassify localized tool availability errors as repairable source errors', async () => {
  const { service } = await fixture(
    mockCompile().mockImplementation((_args, port) => {
      port.postMessage({
        message:
          'Checking tools availability...\nError: Command failed: iec2c.exe -v\nDer Befehl konnte nicht gefunden werden.\nStopping compilation process.',
      })
      return Promise.resolve()
    }),
  )
  expect((await service.compile(request())).repairable).toBe(false)
})

test('rejects paths, executable and upload options, unknown boards and Python before compiler invocation', async () => {
  const { service, compileProgram } = await fixture()
  for (const input of [
    { ...request(), projectPath: root },
    { ...request(), compileOnly: false },
    { ...request(), board: '../escape' },
    { ...request(), board: 'unknown' },
  ])
    expect((await service.compile(input)).success).toBe(false)
  const python = request()
  python.data.pous[0].data.body.language = 'python'
  expect((await service.compile(python)).success).toBe(false)
  expect(compileProgram).not.toHaveBeenCalled()
})

test('serializes builds and releases the lock on compiler exceptions', async () => {
  let release!: () => void
  const { service } = await fixture(
    mockCompile().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    ),
  )
  const first = service.compile(request())
  await expect(service.compile(request())).rejects.toThrow('already running')
  while (!release) await new Promise((resolve) => setImmediate(resolve))
  release()
  await first
  const bad = await fixture(mockCompile().mockRejectedValue(new Error('ENOENT compiler')))
  expect((await bad.service.compile(request())).repairable).toBe(false)
  expect((await bad.service.compile(request())).success).toBe(false)
})
