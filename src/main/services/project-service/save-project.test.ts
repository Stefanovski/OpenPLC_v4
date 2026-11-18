import { promises } from 'fs'
import { join } from 'path'

import { ProjectService } from './index'

jest.mock('electron', () => ({ app: {}, BrowserWindow: jest.fn(), dialog: {} }))
jest.mock('@root/main/utils', () => ({ fileOrDirectoryExists: jest.fn(() => true) }))
jest.mock('../../../utils/i18n', () => ({ i18n: { t: (key: string) => key } }))
jest.mock('./utils', () => ({}))
jest.mock('@root/utils/PLC/pou-text-serializer', () => ({ serializePouToText: () => 'PROGRAM main END_PROGRAM' }))
jest.mock('fs', () => ({ promises: { writeFile: jest.fn(), mkdir: jest.fn(), unlink: jest.fn() } }))

const write = jest.mocked(promises.writeFile)
const writtenPath = (path: Parameters<typeof promises.writeFile>[0]): string => {
  if (typeof path !== 'string') throw new Error('Expected a string file path')
  return path
}
const root = join(process.cwd(), 'save-test-fixture')
const data = () =>
  ({
    projectPath: root,
    content: {
      projectData: { meta: { name: 'test', type: 'plc-project' }, data: { deletedPous: [] } },
      pous: [{ type: 'program', data: { name: 'main', body: { language: 'st', value: '' }, variables: [] } }],
      deviceConfiguration: {},
      devicePinMapping: [],
    },
  }) as unknown as Parameters<ProjectService['saveProject']>[0]
const service = new ProjectService(null as unknown as ConstructorParameters<typeof ProjectService>[0])

beforeEach(() => {
  jest.clearAllMocks()
  write.mockResolvedValue(undefined)
})

it('writes project metadata only after POU contents', async () => {
  const result = await service.saveProject(data())
  expect(result.success).toBe(true)
  const paths = write.mock.calls.map(([path]) => writtenPath(path))
  expect(paths.at(-1)).toBe(join(root, 'project.json'))
  expect(paths).toContain(join(root, 'pous', 'programs', 'main.st'))
})

it('leaves metadata and obsolete files alone when a POU write fails', async () => {
  write.mockImplementation((path) =>
    writtenPath(path).endsWith('.st') ? Promise.reject(new Error('disk full')) : Promise.resolve(),
  )
  const input = data()
  input.content.projectData.data.deletedPous = [{ name: 'old', type: 'program', language: 'st' }]
  expect((await service.saveProject(input)).success).toBe(false)
  expect(write.mock.calls.map(([path]) => writtenPath(path))).not.toContain(join(root, 'project.json'))
  expect(promises.unlink).not.toHaveBeenCalled()
})

it('waits for outstanding writes before reporting a failure and allowing retry', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  write.mockImplementation(async (path) => {
    if (writtenPath(path).endsWith('configuration.json')) throw new Error('disk full')
    if (writtenPath(path).endsWith('pin-mapping.json')) await pending
  })
  let finished = false
  const saving = service.saveProject(data()).then((result) => {
    finished = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  expect(finished).toBe(false)
  release()
  expect((await saving).success).toBe(false)
  expect(write.mock.calls.map(([path]) => writtenPath(path))).not.toContain(join(root, 'project.json'))
})

it('accepts the native project.json path without nesting directories', async () => {
  const input = data()
  input.projectPath = join(root, 'project.json')
  expect((await service.saveProject(input)).success).toBe(true)
  expect(write.mock.calls.map(([path]) => writtenPath(path))).toContain(join(root, 'project.json'))
})
