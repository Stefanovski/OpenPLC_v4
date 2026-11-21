import { baseTypeSchema, PLCPou, PLCPouSchema, PLCVariable } from '@root/types/PLC/open-plc'
import type { PlcContextAttachment } from '@root/types/plc-operations/context'
import { parsePlcContext } from '@root/types/plc-operations/context'
import { parsePlcEditReply,PlcProposal } from '@root/types/plc-operations/edits'
import { validateEurosonicCpp } from '@root/utils/cpp/eurosonic'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'
import { isLegalIdentifier } from '@root/utils/keywords'

import type { RootState } from '../store'
import type { EditorModel } from '../store/slices/editor'
import { buildPlcContext } from './context'

/** Exclude navigation and IO read timestamps, but include all project content used by the model. */
export function contentKey(attachment: PlcContextAttachment) {
  const c = parsePlcContext(attachment.snapshot)
  return JSON.stringify({
    path: attachment.projectPath,
    name: c.project.name,
    pous: c.project.pous,
    dataTypes: c.project.dataTypes,
    resource: c.project.resource,
    device: c.device,
    expected: c.io.expected,
  })
}
function guard(state: RootState) {
  if (
    state.workspace.isDebuggerVisible ||
    state.workspace.debuggerTargetIp ||
    state.workspace.plcOperationsDebuggerActive
  )
    throw new Error('Disconnect the PLC debugger before applying or undoing project changes.')
  if (state.workspace.editingState === 'save-request') throw new Error('Wait for the current save operation.')
}
function legal(name: string) {
  if (
    !isLegalIdentifier(name)[0] ||
    /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]|__proto__|constructor|prototype)$/i.test(name)
  )
    throw new Error(`Invalid or reserved identifier: ${name}`)
}
/** The existing IEC parser intentionally skips text outside blocks; proposals must never lose such text. */
function declarations(text: string, pous: PLCPou[], state: RootState): PLCVariable[] {
  let block = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^VAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP|_EXTERNAL)?(?:\s+RETAIN)?$/i.test(line)) {
      if (block) throw new Error('Nested declaration block.')
      block = true
    } else if (/^END_VAR$/i.test(line)) {
      if (!block) throw new Error('Unexpected END_VAR.')
      block = false
    } else if (!block) throw new Error('Declarations require complete VAR blocks, with one variable per line.')
  }
  if (block) throw new Error('Missing END_VAR in declarations.')
  const variables = parseIecStringToVariables(text, pous, state.project.data.dataTypes, state.libraries)
  for (const v of variables) {
    legal(v.name)
    if (v.location && !/^%[IQM](?:X\d+\.[0-7]|[BWDL]\d+)$/i.test(v.location))
      throw new Error(`Invalid IO location: ${v.location}`)
    const type = v.type.definition === 'array' ? v.type.data.baseType : v.type
    if (
      type.definition === 'user-data-type' &&
      !state.project.data.dataTypes.some((d) => d.name.toLowerCase() === type.value.toLowerCase())
    )
      throw new Error(`Unknown data type: ${type.value}`)
  }
  return variables
}

type Patch = Pick<RootState, 'project' | 'files' | 'libraries' | 'editor' | 'editors' | 'history'>
export type PlcUndo = {
  projectPath: string
  key: string
  before: Patch
  tabs: RootState['tabs']
  selectedTab: RootState['selectedTab']
  editingState: RootState['workspace']['editingState']
}
const undoKey = (s: RootState) => JSON.stringify([contentKey(buildPlcContext(s)), s.files, s.workspace.editingState])

export function preparePlcChanges(state: RootState, proposal: PlcProposal) {
  guard(state)
  if (contentKey(buildPlcContext(state)) !== contentKey(proposal.base))
    throw new Error('The project changed since this request. Request a fresh proposal; your edits were kept.')
  const reply = parsePlcEditReply(JSON.stringify(proposal.reply))
  if (!reply.changes.length && !reply.instances.length) throw new Error('This reply has no changes.')
  const touched = new Set<string>()
  const pous = [...state.project.data.pous]
  const oldByName = new Map(pous.map((p) => [p.data.name, p]))
  const systemNames = state.libraries.system.flatMap((lib) =>
    'pous' in lib ? lib.pous.map((p) => p.name.toLowerCase()) : [],
  )
  const files = { ...state.files }
  const userLibraries = [...state.libraries.user]
  // Register all new POU signatures first, so an ST program may instantiate a C++ FB from the same batch.
  for (const change of reply.changes) {
    legal(change.name)
    const key = change.name.toLowerCase()
    if (touched.has(key)) throw new Error(`Duplicate change: ${change.name}`)
    touched.add(key)
    const old = oldByName.get(change.name)
    if (change.operation === 'create') {
      if (
        pous.some((p) => p.data.name.toLowerCase() === key) ||
        state.project.data.dataTypes.some((d) => d.name.toLowerCase() === key) ||
        systemNames.includes(key) ||
        userLibraries.some((library) => library.name.toLowerCase() === key) ||
        Object.keys(files).some((n) => n.toLowerCase() === key) ||
        state.project.data.deletedPous?.some((p) => p.name.toLowerCase() === key)
      )
        throw new Error(`Name already exists or is pending deletion: ${change.name}`)
      pous.push(
        PLCPouSchema.parse({
          type: change.kind,
          data: {
            name: change.name,
            language: change.language,
            returnType: change.returnType,
            documentation: change.documentation,
            variables: [],
            body: { language: change.language, value: change.body },
          },
        }),
      )
      files[change.name] = { type: change.kind, filePath: `/pous/${change.kind}s/${change.name}.json`, saved: false }
      if (change.kind !== 'program') userLibraries.push({ name: change.name, type: change.kind })
    } else if (!old || old.type !== change.kind || old.data.body.language !== change.language) {
      throw new Error(`Update requires the exact existing name, kind and language: ${change.name}`)
    }
    if (change.kind === 'function') {
      if (
        !baseTypeSchema.safeParse(change.returnType.toLowerCase()).success &&
        !state.project.data.dataTypes.some((d) => d.name === change.returnType)
      )
        throw new Error(`Unknown function return type: ${change.returnType}`)
      if (old?.type === 'function' && old.data.returnType.toLowerCase() !== change.returnType.toLowerCase())
        throw new Error('Changing a function return type requires refactoring.')
    } else if (change.returnType) throw new Error('Only functions have a return type.')
  }
  const editors = new Map([...state.editors, state.editor].map((e) => [e.meta.name, e]))
  for (const change of reply.changes) {
    const old = oldByName.get(change.name)
    const variables = declarations(change.declarations, pous, state)
    if (old) {
      const editor = editors.get(change.name)
      const raw =
        editor?.type === 'plc-textual' && editor.variable.display === 'code' ? editor.variable.code : undefined
      const oldText = raw ?? old.data.variablesText
      const oldVars = oldText !== undefined ? declarations(oldText, state.project.data.pous, state) : old.data.variables
      const signature = (vars: PLCVariable[]) =>
        JSON.stringify(
          vars
            .filter((v) => ['input', 'output', 'inOut'].includes(v.class ?? ''))
            .map((v) => [v.name, v.class, v.type]),
        )
      if (signature(oldVars) !== signature(variables))
        throw new Error(`Changing the public interface of ${change.name} requires refactoring.`)
      for (const v of oldVars.filter((v) => v.location)) {
        const next = variables.find((n) => n.name === v.name)
        if (
          !next ||
          next.location !== v.location ||
          JSON.stringify(next.type) !== JSON.stringify(v.type) ||
          next.class !== v.class
        )
          throw new Error(`Rebinding or removing located variable ${v.name} requires refactoring.`)
      }
      for (const v of variables) v.debug = old.data.variables.find((o) => o.name === v.name)?.debug ?? false
    }
    if (change.language === 'cpp') {
      const board = state.deviceAvailableOptions.availableBoards.get(state.deviceDefinitions.configuration.deviceBoard)
      if (board?.compiler !== 'eurosonic-cli')
        throw new Error('C++ proposals currently require a Eurosonic compiler target.')
      const validation = validateEurosonicCpp({ name: change.name, code: change.body, variables }, change.kind)
      if (!validation.valid) throw new Error(validation.error)
    }
    const index = pous.findIndex((p) => p.data.name === change.name)
    const data = {
      ...pous[index].data,
      documentation: change.documentation,
      variables,
      variablesText: change.declarations,
      body: { language: change.language, value: change.body },
    }
    pous[index] = PLCPouSchema.parse({ type: change.kind, data })
    const file = files[change.name]
    if (!file) throw new Error(`Missing editor file registration: ${change.name}`)
    files[change.name] = { ...file, saved: false }
  }
  const resource = state.project.data.configuration.resource
  const instances = [...resource.instances]
  for (const instance of reply.instances) {
    legal(instance.name)
    if (
      instances.some(
        (i) =>
          i.name.toLowerCase() === instance.name.toLowerCase() ||
          i.program.toLowerCase() === instance.program.toLowerCase(),
      )
    )
      throw new Error(`Instance or scheduled program already exists: ${instance.name}`)
    if (
      !resource.tasks.some((t) => t.name === instance.task) ||
      !pous.some((p) => p.type === 'program' && p.data.name === instance.program)
    )
      throw new Error('New instances must reference an existing task and a program in the resulting project.')
    instances.push(instance)
  }
  if (reply.instances.length)
    for (const [name, file] of Object.entries(files))
      if (file.type === 'resource') files[name] = { ...file, saved: false }
  const updateEditor = (editor: EditorModel): EditorModel => {
    const change = reply.changes.find((c) => c.name === editor.meta.name)
    return change && editor.type === 'plc-textual'
      ? { ...editor, variable: { display: 'code', code: change.declarations } }
      : editor
  }
  const history = { ...state.history }
  // Old per-POU snapshots must not restore declarations that precede this transaction.
  for (const change of reply.changes) delete history[change.name]
  const patch: Patch = {
    project: {
      ...state.project,
      data: {
        ...state.project.data,
        pous,
        configuration: { ...state.project.data.configuration, resource: { ...resource, instances } },
      },
    },
    files,
    libraries: { ...state.libraries, user: userLibraries },
    history,
    editor: updateEditor(state.editor),
    editors: state.editors.map(updateEditor),
  }
  const after = { ...state, ...patch, workspace: { ...state.workspace, editingState: 'unsaved' as const } }
  const undo: PlcUndo = {
    projectPath: state.project.meta.path,
    key: undoKey(after),
    before: {
      project: state.project,
      files: state.files,
      libraries: state.libraries,
      editor: state.editor,
      editors: state.editors,
      history: state.history,
    },
    tabs: state.tabs,
    selectedTab: state.selectedTab,
    editingState: state.workspace.editingState,
  }
  return { patch: { ...patch, workspace: after.workspace }, undo }
}

export function preparePlcUndo(state: RootState, undo: PlcUndo): Partial<RootState> {
  guard(state)
  if (state.project.meta.path !== undo.projectPath || undoKey(state) !== undo.key)
    throw new Error('The project was edited or saved after this Plc change. Undo was stopped to preserve that work.')
  return {
    ...undo.before,
    tabs: undo.tabs,
    selectedTab: undo.selectedTab,
    workspace: { ...state.workspace, editingState: undo.editingState },
  }
}
