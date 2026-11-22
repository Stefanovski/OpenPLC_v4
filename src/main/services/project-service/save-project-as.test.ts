/* Electron methods below are replaced by jest mocks; they do not use this. */
/* eslint-disable @typescript-eslint/unbound-method */
import { defaultDeviceConfiguration } from '@root/renderer/store/slices/device/data'
import type { SaveProjectRequest } from '@root/types/IPC/project-service'
import { parseTextualPouFromString } from '@root/utils/PLC/pou-text-parser'
import { dialog } from 'electron'
import { existsSync, promises } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { gvlFixture } from '../../../../scripts/eurosonic/fixtures/gvl'
import { ProjectService } from './index'
import { readProjectFiles } from './utils/read-project'

jest.mock('electron', () => ({ app: {}, BrowserWindow: jest.fn(), dialog: { showSaveDialog: jest.fn() } }))
jest.mock('@root/main/utils', () => ({ fileOrDirectoryExists: (path: string) => existsSync(path) }))
jest.mock('../../../utils/i18n', () => ({ i18n: { t: (key: string) => key } }))
jest.mock('./utils', () => ({}))

let root: string
let source: string
let target: string
let service: ProjectService
const input = (): SaveProjectRequest => ({
  projectPath: source,
  content: {
    projectData: {
      meta: { name: 'Example', type: 'plc-project' as const },
      data: {
        dataTypes: [],
        pous: [],
        deletedPous: [{ name: 'old', type: 'program' as const, language: 'st' as const }],
        configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
    },
    pous: [
      {
        type: 'program' as const,
        data: {
          name: 'main',
          language: 'st' as const,
          documentation: '',
          variables: [],
          variablesText: 'VAR\n Counter : INT;\nEND_VAR',
          body: { language: 'st' as const, value: 'Counter := 42;' },
        },
      },
    ],
    deviceConfiguration: structuredClone(defaultDeviceConfiguration),
    devicePinMapping: [],
  },
})

beforeEach(async () => {
  root = await promises.mkdtemp(join(tmpdir(), 'openplc-save-as-'))
  source = join(root, 'source')
  target = join(root, 'copy')
  await promises.mkdir(source)
  await promises.writeFile(join(source, 'project.json'), 'ORIGINAL metadata')
  await promises.writeFile(join(source, 'old.st'), 'ORIGINAL unsaved-on-disk body')
  service = new ProjectService(null as unknown as ConstructorParameters<typeof ProjectService>[0])
  jest.spyOn(service, 'updateProjectHistory').mockResolvedValue(undefined)
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target })
})

afterEach(async () => {
  expect(await promises.readFile(join(source, 'project.json'), 'utf8')).toBe('ORIGINAL metadata')
  expect(await promises.readFile(join(source, 'old.st'), 'utf8')).toBe('ORIGINAL unsaved-on-disk body')
  expect((await promises.readdir(source)).sort()).toEqual(['old.st', 'project.json'])
  jest.restoreAllMocks()
  // root is an exclusive mkdtemp directory owned by this test; never a user path.
  await promises.rm(root, { recursive: true, force: true })
})

it('writes the supplied unsaved snapshot and leaves original bytes untouched', async () => {
  const data = input()
  const before = structuredClone(data)
  expect(await service.saveProjectAs(data)).toEqual({ success: true, projectPath: target })
  const text = await promises.readFile(join(target, 'pous/programs/main.st'), 'utf8')
  expect(text).toContain('Counter := 42;')
  expect(text).toContain('Counter : INT;')
  const reopened = parseTextualPouFromString(text, 'st', 'program')
  expect(reopened.data.body.value).toContain('Counter := 42;')
  expect(reopened.data.variables[0].name).toBe('Counter')
  expect(JSON.parse(await promises.readFile(join(target, 'project.json'), 'utf8'))).toMatchObject({
    data: { deletedPous: [] },
  })
  expect(existsSync(join(target, 'devices/configuration.json'))).toBe(true)
  expect(data).toEqual(before)
})

it('roundtrips named GVLs, IO, RETAIN and incomplete drafts through Save As and Save', async () => {
  const data = input()
  const fixture = gvlFixture()
  data.content.projectData.data = { ...fixture, pous: [] }
  data.content.pous = fixture.pous
  fixture.globalVariableLists![0].variables[0].debug = true
  fixture.globalVariableLists![1].variablesText = 'VAR_GLOBAL RETAIN\n Count : UDINT := 42;\nEND_VAR'
  expect((await service.saveProjectAs(data)).success).toBe(true)
  let reopened = await readProjectFiles(target)
  expect(reopened.success).toBe(true)
  expect(reopened.data?.project.data.globalVariableLists).toEqual(fixture.globalVariableLists)
  expect(reopened.data?.pous[0].data.body.value).toContain('GVL_IO.Lamp')
  data.projectPath = target
  fixture.globalVariableLists![1].variablesText = 'VAR_GLOBAL RETAIN\n Count :'
  expect((await service.saveProject(data)).success).toBe(true)
  reopened = await readProjectFiles(target)
  expect(reopened.data?.project.data.globalVariableLists).toEqual(fixture.globalVariableLists)
})

it('cancels without creating a destination', async () => {
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
  expect(await service.saveProjectAs(input())).toEqual({ success: false, canceled: true })
  expect(existsSync(target)).toBe(false)
})

it.each(['file', 'empty-folder', 'project-folder'])('refuses an existing %s', async (kind) => {
  if (kind === 'file') await promises.writeFile(target, 'keep me')
  else {
    await promises.mkdir(target)
    if (kind === 'project-folder') await promises.writeFile(join(target, 'project.json'), 'keep me')
  }
  expect((await service.saveProjectAs(input())).success).toBe(false)
  if (kind === 'file') expect(await promises.readFile(target, 'utf8')).toBe('keep me')
  else expect(await promises.readdir(target)).toEqual(kind === 'empty-folder' ? [] : ['project.json'])
})

it.each(['same', 'child'])('refuses the source or a path inside it (%s)', async (kind) => {
  jest
    .mocked(dialog.showSaveDialog)
    .mockResolvedValue({ canceled: false, filePath: kind === 'same' ? source : join(source, 'copy') })
  expect((await service.saveProjectAs(input())).success).toBe(false)
})

it('resolves a junction before checking containment', async () => {
  const alias = join(root, 'alias')
  await promises.symlink(source, alias, 'junction')
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: join(alias, 'copy') })
  expect((await service.saveProjectAs(input())).success).toBe(false)
  await promises.unlink(alias)
})

it('reports a real write failure without changing original data or payload', async () => {
  const data = input()
  const before = structuredClone(data)
  const write = promises.writeFile.bind(promises)
  jest.spyOn(promises, 'writeFile').mockImplementation(async (path, ...args) => {
    if (typeof path === 'string' && path.endsWith('main.st')) throw new Error('simulated disk full')
    return write(path, ...args)
  })
  expect((await service.saveProjectAs(data)).success).toBe(false)
  expect(existsSync(join(target, 'project.json'))).toBe(false)
  expect(data).toEqual(before)
})

it('rejects POU path traversal before creating a folder', async () => {
  const data = input()
  data.content.pous[0].data.name = '../../../source/old'
  expect((await service.saveProjectAs(data)).success).toBe(false)
  expect(existsSync(target)).toBe(false)
})

it('rejects project.json as a folder name before saveProject can interpret it as a file path', async () => {
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: join(root, 'project.json') })
  expect((await service.saveProjectAs(input())).success).toBe(false)
  expect((await promises.readdir(root)).sort()).toEqual(['source'])
})

it('keeps a successful copy when updating recent projects fails', async () => {
  jest.mocked(service.updateProjectHistory).mockRejectedValue(new Error('history unavailable'))
  expect((await service.saveProjectAs(input())).success).toBe(true)
})

it('reopens ST, C++, FBD and LD copies through the real project reader and saves only the copy afterwards', async () => {
  const data = input()
  data.content.pous.push(
    {
      type: 'function-block',
      data: {
        name: 'CppBlink',
        language: 'cpp',
        documentation: '',
        variables: [],
        variablesText: 'VAR_OUTPUT\n Lamp : BOOL;\nEND_VAR',
        body: { language: 'cpp', value: 'void loop() { Lamp = !Lamp; }' },
      },
    },
    {
      type: 'program',
      data: {
        name: 'diagram',
        language: 'fbd',
        documentation: '',
        variables: [],
        body: { language: 'fbd', value: { name: 'diagram', rung: { comment: 'unsaved FBD', nodes: [], edges: [] } } },
      },
    },
    {
      type: 'program',
      data: {
        name: 'ladder',
        language: 'ld',
        documentation: '',
        variables: [],
        body: { language: 'ld', value: { name: 'ladder', rungs: [] } },
      },
    },
  )
  expect((await service.saveProjectAs(data)).success).toBe(true)
  const reopened = await readProjectFiles(target)
  expect(reopened.success).toBe(true)
  expect(reopened.data?.project.meta.name).toBe('Example')
  expect(reopened.data?.deviceConfiguration).toEqual(data.content.deviceConfiguration)
  expect(reopened.data?.pous.map((pou) => pou.data.name).sort()).toEqual(['CppBlink', 'diagram', 'ladder', 'main'])
  expect(reopened.data?.pous.find((pou) => pou.data.name === 'CppBlink')?.data.body.value).toContain('Lamp = !Lamp')
  expect(reopened.data?.pous.find((pou) => pou.data.name === 'diagram')?.data.body.value).toMatchObject({
    rung: { comment: 'unsaved FBD' },
  })
  data.projectPath = target
  data.content.pous[0].data.body = { language: 'st', value: 'Counter := 99;' }
  expect((await service.saveProject(data)).success).toBe(true)
  expect(await promises.readFile(join(target, 'pous/programs/main.st'), 'utf8')).toContain('Counter := 99;')
})
