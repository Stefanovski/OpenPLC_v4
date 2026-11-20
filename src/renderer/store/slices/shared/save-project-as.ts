import type { SaveProjectAsResponse, SaveProjectRequest } from '@root/types/IPC/project-service'
import { deviceConfigurationSchema, devicePinSchema } from '@root/types/PLC/devices'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'

import type { RootState } from '../../index'
import type { EditorModel } from '../editor'
import { zodFBDFlowSchema } from '../fbd/types'
import { zodLadderFlowSchema } from '../ladder/types'

export type SaveAsState = Pick<
  RootState,
  | 'project'
  | 'deviceDefinitions'
  | 'editor'
  | 'editors'
  | 'fbdFlows'
  | 'ladderFlows'
  | 'files'
  | 'tabs'
  | 'workspace'
  | 'libraries'
>

// Build a detached snapshot; never save the source as an intermediate step.
export function snapshotProject(state: SaveAsState): SaveProjectRequest {
  const projectData = PLCProjectSchema.parse(state.project)
  const editors = new Map([...state.editors, state.editor].map((editor) => [editor.meta.name, editor]))
  const pous = projectData.data.pous.map((pou) => {
    const editor = editors.get(pou.data.name)
    if ((editor?.type === 'plc-textual' || editor?.type === 'plc-graphical') && editor.variable.display === 'code') {
      if (editor.variable.code !== undefined) pou.data.variablesText = editor.variable.code
    }
    if (pou.data.body.language === 'fbd') {
      const flow = state.fbdFlows.find((candidate) => candidate.name === pou.data.name)
      if (flow) pou.data.body.value = zodFBDFlowSchema.parse(flow)
    }
    if (pou.data.body.language === 'ld') {
      const flow = state.ladderFlows.find((candidate) => candidate.name === pou.data.name)
      if (flow) pou.data.body.value = zodLadderFlowSchema.parse(flow)
    }
    return pou
  })
  for (const editor of editors.values()) {
    if (editor.type === 'plc-resource' && editor.variable.display === 'code' && editor.variable.code !== undefined) {
      // Unlike POUs, resource declarations have no raw-text persistence field.
      // Refuse invalid text instead of silently losing it in the saved copy.
      const debugNames = new Set(
        projectData.data.configuration.resource.globalVariables.filter((v) => v.debug).map((v) => v.name.toLowerCase()),
      )
      projectData.data.configuration.resource.globalVariables = parseIecStringToVariables(
        editor.variable.code,
        pous,
        projectData.data.dataTypes,
        state.libraries,
      ).map((variable) => ({ ...variable, debug: debugNames.has(variable.name.toLowerCase()) }))
    }
  }
  projectData.data.debugVariables = {
    global: projectData.data.configuration.resource.globalVariables.filter((v) => v.debug).map((v) => v.name),
    pous: Object.fromEntries(
      pous.map((pou) => [pou.data.name, pou.data.variables.filter((v) => v.debug).map((v) => v.name)]),
    ),
  }
  projectData.data.pous = []
  projectData.data.deletedPous = []
  return {
    projectPath: state.project.meta.path,
    content: {
      projectData,
      pous,
      deviceConfiguration: deviceConfigurationSchema.parse(state.deviceDefinitions.configuration),
      devicePinMapping: devicePinSchema.array().parse(state.deviceDefinitions.pinMapping.pins),
    },
  }
}

export function rebaseProjectPath(path: string, source: string, destination: string): string {
  const normalize = (value: string) =>
    value
      .replace(/\\/g, '/')
      .replace(/\/$/, '')
      .replace(/\/project\.json$/, '')
  const oldRoot = normalize(source)
  const value = path.replace(/\\/g, '/')
  // Drive-letter and UNC paths are case insensitive; POSIX paths are not.
  const compare = (text: string) => (/^(?:[a-z]:|\/\/)/i.test(oldRoot) ? text.toLowerCase() : text)
  if (compare(value) === compare(oldRoot)) return destination
  return compare(value).startsWith(`${compare(oldRoot)}/`) ? normalize(destination) + value.slice(oldRoot.length) : path
}

export function adoptProjectCopy(
  state: SaveAsState,
  source: string,
  destination: string,
  unchanged: boolean,
  currentSnapshot?: SaveProjectRequest,
): Partial<SaveAsState> {
  const rebase = (path: string) => rebaseProjectPath(path, source, destination)
  const editorPath = (editor: EditorModel): EditorModel => {
    if (editor.type === 'plc-textual') {
      return { ...editor, meta: { ...editor.meta, path: rebase(editor.meta.path) } }
    }
    if (editor.type === 'plc-graphical') {
      return { ...editor, meta: { ...editor.meta, path: rebase(editor.meta.path) } }
    }
    if (editor.type === 'plc-resource') {
      return { ...editor, meta: { ...editor.meta, path: rebase(editor.meta.path) } }
    }
    return editor
  }
  return {
    project: {
      ...state.project,
      meta: { ...state.project.meta, path: destination },
      data: {
        ...state.project.data,
        ...(currentSnapshot ? { ...currentSnapshot.content.projectData.data, pous: currentSnapshot.content.pous } : {}),
        deletedPous: unchanged ? [] : state.project.data.deletedPous,
      },
    },
    files: Object.fromEntries(
      Object.entries(state.files).map(([name, file]) => [
        name,
        { ...file, filePath: rebase(file.filePath), saved: unchanged ? true : file.saved },
      ]),
    ),
    tabs: state.tabs.map((tab) => ({ ...tab, path: tab.path === undefined ? undefined : rebase(tab.path) })),
    editor: editorPath(state.editor),
    editors: state.editors.map(editorPath),
    workspace: { ...state.workspace, editingState: unchanged ? 'saved' : 'unsaved' },
  }
}

export function createSaveProjectAsAction(
  get: () => SaveAsState,
  set: (update: Partial<SaveAsState>) => void,
  save: (request: SaveProjectRequest) => Promise<SaveProjectAsResponse>,
) {
  let pending = false
  return async (): Promise<SaveProjectAsResponse> => {
    if (pending) return { success: false, canceled: true }
    pending = true
    try {
      const snapshot = snapshotProject(get())
      if (!snapshot.projectPath) return { success: false, error: 'Open a project before using Save As.' }
      const fingerprint = JSON.stringify(snapshot)
      const result = await save(snapshot)
      if (!result.success || !result.projectPath) return result
      const current = get()
      // The user may have closed or opened a different project during I/O.
      if (current.project.meta.path !== snapshot.projectPath) return result
      let unchanged = false
      let currentSnapshot: SaveProjectRequest | undefined
      try {
        currentSnapshot = snapshotProject(current)
        unchanged = JSON.stringify(currentSnapshot) === fingerprint
      } catch {
        /* New invalid edits remain dirty. */
      }
      // Preserve open models, undo history and edits made while the copy was written.
      set(adoptProjectCopy(current, snapshot.projectPath, result.projectPath, unchanged, currentSnapshot))
      return result
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      pending = false
    }
  }
}
