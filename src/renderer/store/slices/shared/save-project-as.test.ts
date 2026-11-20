import type { SaveProjectAsResponse, SaveProjectRequest } from '@root/types/IPC/project-service'

import { defaultDeviceConfiguration } from '../device/data'
import { createSaveProjectAsAction, rebaseProjectPath, SaveAsState, snapshotProject } from './save-project-as'

const fixture = (): SaveAsState => ({
  project: {
    meta: { name: 'Example', type: 'plc-project', path: 'C:/projects/source' },
    data: {
      dataTypes: [],
      deletedPous: [{ name: 'obsolete', type: 'program', language: 'st' }],
      configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
      pous: [
        {
          type: 'function-block',
          data: {
            name: 'CppBlink',
            language: 'cpp',
            documentation: '',
            variables: [],
            body: { language: 'cpp', value: 'void loop() { Lamp = !Lamp; }' },
          },
        },
      ],
    },
  },
  deviceDefinitions: {
    configuration: structuredClone(defaultDeviceConfiguration),
    pinMapping: { pins: [], currentSelectedPinTableRow: -1 },
    compileOnly: true,
  },
  editor: {
    type: 'plc-textual',
    meta: {
      name: 'CppBlink',
      path: 'C:/projects/source/pous/function-blocks/CppBlink.cpp',
      language: 'cpp',
      pouType: 'function-block',
    },
    variable: { display: 'code', code: 'VAR_OUTPUT\n Lamp : BOOL;\nEND_VAR' },
  },
  editors: [],
  fbdFlows: [],
  ladderFlows: [],
  libraries: { system: [], user: [] } as unknown as SaveAsState['libraries'],
  files: {
    CppBlink: {
      type: 'function-block',
      saved: false,
      filePath: 'C:/projects/source/pous/function-blocks/CppBlink.cpp',
    },
  },
  tabs: [
    {
      name: 'CppBlink',
      path: 'C:/projects/source/pous/function-blocks/CppBlink.cpp',
      elementType: { type: 'function-block', language: 'cpp' },
    },
  ],
  workspace: { editingState: 'unsaved' } as SaveAsState['workspace'],
})

it('captures unsaved C++ and raw declarations without changing the source model', () => {
  const state = fixture()
  const before = structuredClone(state)
  const snapshot = snapshotProject(state)
  expect(snapshot.content.pous[0].data.variablesText).toContain('Lamp : BOOL')
  expect(snapshot.content.pous[0].data.body.value).toContain('Lamp = !Lamp')
  expect(snapshot.content.projectData.data.deletedPous).toEqual([])
  expect(snapshot.content.projectData.data.pous).toEqual([])
  expect(state).toEqual(before)
})

it('takes the latest graphical flow rather than a stale POU body', () => {
  const state = fixture()
  state.project.data.pous = [
    {
      type: 'program',
      data: {
        name: 'main',
        language: 'fbd',
        documentation: '',
        variables: [],
        body: { language: 'fbd', value: { name: 'main', rung: { comment: 'old', nodes: [], edges: [] } } },
      },
    },
  ]
  state.fbdFlows = [
    { name: 'main', updated: true, rung: { comment: 'unsaved diagram', nodes: [], edges: [], selectedNodes: [] } },
  ]
  expect(snapshotProject(state).content.pous[0].data.body.value).toMatchObject({ rung: { comment: 'unsaved diagram' } })
})

it.each([
  { success: false, canceled: true },
  { success: false, error: 'disk full' },
])('does not alter any state on %j', async (response) => {
  const state = fixture()
  const before = structuredClone(state)
  const set = jest.fn()
  const save = jest.fn().mockResolvedValue(response)
  expect(await createSaveProjectAsAction(() => state, set, save)()).toEqual(response)
  expect(set).not.toHaveBeenCalled()
  expect(state).toEqual(before)
})

it('rebases open files and keeps editor models on success', async () => {
  let state = fixture()
  const action = createSaveProjectAsAction(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
    () => Promise.resolve({ success: true, projectPath: 'C:/projects/copy' }),
  )
  await action()
  expect(state.project.meta.path).toBe('C:/projects/copy')
  expect(state.files.CppBlink.filePath).toBe('C:/projects/copy/pous/function-blocks/CppBlink.cpp')
  expect(state.tabs[0].path).toBe(state.files.CppBlink.filePath)
  expect(state.editor).toMatchObject({
    meta: { path: state.files.CppBlink.filePath },
  })
  if (state.editor.type !== 'plc-textual' || state.editor.variable.display !== 'code') throw new Error('Editor lost')
  expect(state.editor.variable.code).toContain('Lamp : BOOL')
  expect(state.workspace.editingState).toBe('saved')
  expect(state.project.data.deletedPous).toEqual([])
})

it('preserves edits made during I/O and leaves the new project dirty', async () => {
  let state = fixture()
  const action = createSaveProjectAsAction(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
    () => {
      state = structuredClone(state)
      state.project.data.pous[0].data.body = { language: 'cpp', value: '// newer unsaved edit' }
      return Promise.resolve({ success: true, projectPath: 'C:/projects/copy' })
    },
  )
  await action()
  expect(state.project.data.pous[0].data.body.value).toBe('// newer unsaved edit')
  expect(state.workspace.editingState).toBe('unsaved')
  expect(state.files.CppBlink.saved).toBe(false)
})

it('does not replace a different project opened during I/O', async () => {
  let state = fixture()
  const set = jest.fn()
  const action = createSaveProjectAsAction(
    () => state,
    set,
    () => {
      state = structuredClone(state)
      state.project.meta.path = 'C:/different'
      return Promise.resolve({ success: true, projectPath: 'C:/copy' })
    },
  )
  await action()
  expect(set).not.toHaveBeenCalled()
})

it('handles rejected IPC and permits a subsequent retry', async () => {
  const set = jest.fn()
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error('IPC failed'))
    .mockResolvedValueOnce({ success: false, canceled: true })
  const action = createSaveProjectAsAction(fixture, set, save)
  expect(await action()).toEqual({ success: false, error: 'IPC failed' })
  expect(await action()).toEqual({ success: false, canceled: true })
  expect(set).not.toHaveBeenCalled()
})

it('rebases Windows paths but leaves relative and unrelated paths alone', () => {
  expect(rebaseProjectPath('c:\\SOURCE\\pous\\main.st', 'C:/source', 'D:/copy')).toBe('D:/copy/pous/main.st')
  expect(rebaseProjectPath('/pous/main.st', 'C:/source', 'D:/copy')).toBe('/pous/main.st')
  expect(rebaseProjectPath('C:/source-other/main.st', 'C:/source', 'D:/copy')).toBe('C:/source-other/main.st')
})

it('keeps unsaved global declarations in the copy and in the adopted project model', async () => {
  let state = fixture()
  state.editor = {
    type: 'plc-resource',
    meta: { name: 'Resource', path: '/project.json' },
    variable: { display: 'code', code: 'VAR_GLOBAL\n NewGlobal : BOOL;\nEND_VAR' },
    task: { display: 'table', selectedRow: '-1' },
    instance: { display: 'table', selectedRow: '-1' },
  }
  const save = jest
    .fn<Promise<SaveProjectAsResponse>, [SaveProjectRequest]>()
    .mockResolvedValue({ success: true, projectPath: 'C:/copy' })
  await createSaveProjectAsAction(
    () => state,
    (patch) => {
      state = { ...state, ...patch }
    },
    save,
  )()
  expect(save.mock.calls[0][0].content.projectData.data.configuration.resource.globalVariables[0].name).toBe(
    'NewGlobal',
  )
  expect(state.project.data.configuration.resource.globalVariables[0].name).toBe('NewGlobal')
})

it('refuses invalid global declaration text without changing or sending anything', async () => {
  const state = fixture()
  state.editor = {
    type: 'plc-resource',
    meta: { name: 'Resource', path: '/project.json' },
    variable: { display: 'code', code: 'VAR_GLOBAL\n Broken : BOOL\nEND_VAR' },
    task: { display: 'table', selectedRow: '-1' },
    instance: { display: 'table', selectedRow: '-1' },
  }
  const before = structuredClone(state)
  const save = jest.fn()
  const set = jest.fn()
  expect((await createSaveProjectAsAction(() => state, set, save)()).success).toBe(false)
  expect(save).not.toHaveBeenCalled()
  expect(set).not.toHaveBeenCalled()
  expect(state).toEqual(before)
})

it('allows only one Save As dialog at a time', async () => {
  let finish!: (value: { success: boolean; canceled: boolean }) => void
  const save = jest.fn(
    () =>
      new Promise<{ success: boolean; canceled: boolean }>((resolve) => {
        finish = resolve
      }),
  )
  const action = createSaveProjectAsAction(fixture, jest.fn(), save)
  const first = action()
  expect(await action()).toEqual({ success: false, canceled: true })
  expect(save).toHaveBeenCalledTimes(1)
  finish({ success: false, canceled: true })
  await first
})
