import type { PrintPageSetup, PrintPou, PrintRequest, PrintVar } from '@root/types/IPC/print'
import { parseGvlDeclarations } from '@root/utils/PLC/global-variable-lists'

import type { RootState } from '../store'
import { buildConfigurationTables } from './print-configuration'

export const defaultPrintPage: PrintPageSetup = {
  size: 'a4',
  orientation: 'portrait',
  marginsPt: { top: 36, right: 36, bottom: 36, left: 36 },
}
export type PrintSelection = {
  names: string[]
  includeConfiguration: boolean
  page: PrintPageSetup
  mode: PrintRequest['mode']
  pagePolicy: PrintRequest['pagePolicy']
}
type PrintState = Pick<RootState, 'project' | 'editors' | 'editor' | 'fbdFlows' | 'ladderFlows'>
const nodeData = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const lines = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text) => ({ runs: [{ text, color: '#111827' }] }))

/** No save, parse/commit, compiler call or store mutation is part of printing. */
export function buildPrintRequest(state: PrintState, selection: PrintSelection): PrintRequest {
  const editors = new Map([...state.editors, state.editor].map((editor) => [editor.meta.name, editor]))
  const pous: PrintPou[] = []
  if (selection.includeConfiguration) {
    const resourceEditor = [...editors.values()].find((editor) => editor.type === 'plc-resource')
    const resource = state.project.data.configuration.resource
    const pendingGlobals =
      resourceEditor?.type === 'plc-resource' && resourceEditor.variable.display === 'code'
        ? resourceEditor.variable.code
        : undefined
    pous.push({
      name: `${state.project.meta.name} — Configuration`,
      kind: 'configuration',
      variables: [],
      tables: buildConfigurationTables(resource, state.project.data.dataTypes, pendingGlobals !== undefined),
      ...(pendingGlobals === undefined
        ? {}
        : { declarations: lines('Global variables — current declaration text\n' + pendingGlobals) }),
    })
  }

  if (selection.includeConfiguration)
    for (const list of state.project.data.globalVariableLists ?? []) {
      try {
        const variables =
          list.variablesText === undefined
            ? list.variables
            : parseGvlDeclarations(list.variablesText, state.project.data)
        pous.push({
          name: `${state.project.meta.name} � ${list.name}`,
          kind: 'configuration',
          variables: [],
          tables: buildConfigurationTables({ globalVariables: variables, tasks: [], instances: [] }, [], false).slice(
            0,
            1,
          ),
        })
      } catch {
        pous.push({
          name: `${state.project.meta.name} � ${list.name} (draft)`,
          kind: 'configuration',
          variables: [],
          tables: [],
          declarations: lines(list.variablesText ?? ''),
        })
      }
    }

  for (const pou of state.project.data.pous.filter((candidate) => selection.names.includes(candidate.data.name))) {
    const editor = editors.get(pou.data.name)
    const code =
      (editor?.type === 'plc-textual' || editor?.type === 'plc-graphical') && editor.variable.display === 'code'
        ? editor.variable.code
        : undefined
    const declarations = code ?? pou.data.variablesText
    const variables: PrintVar[] =
      declarations !== undefined
        ? []
        : pou.data.variables.map((variable) => ({
            name: variable.name,
            varClass: variable.class ?? '',
            flag: variable.retain ? 'retain' : '',
            type:
              variable.type.definition === 'array'
                ? `ARRAY [${variable.type.data.dimensions.map((d) => d.dimension).join(', ')}] OF ${variable.type.data.baseType.value.toUpperCase()}`
                : variable.type.value.toUpperCase(),
            location: variable.location,
            initialValue: variable.initialValue ?? '',
            documentation: variable.documentation,
            debug: variable.debug ?? false,
          }))
    const common = {
      name: pou.data.name,
      variables,
      ...(declarations === undefined ? {} : { declarations: lines(declarations) }),
    }
    // Emit declarations verbatim so even incomplete unsaved edits and long
    // documentation/array types survive; never substitute stale table values.
    const body = pou.data.body
    switch (body.language) {
      case 'fbd': {
        const flow = state.fbdFlows.find((flow) => flow.name === pou.data.name)
        const rung = flow?.rung ?? body.value.rung
        pous.push({
          ...common,
          kind: 'fbd',
          rung: {
            ...rung,
            nodes: rung.nodes.map((node) => ({ ...node, data: nodeData(node.data) })),
            selectedNodes: [],
          },
        })
        break
      }
      case 'ld': {
        const flow = state.ladderFlows.find((flow) => flow.name === pou.data.name)
        pous.push({
          ...common,
          kind: 'ld',
          rungs: (flow?.rungs ?? body.value.rungs).map((rung) => ({
            ...rung,
            nodes: rung.nodes.map((node) => ({ ...node, data: nodeData(node.data) })),
            selectedNodes: [],
          })),
        })
        break
      }
      case 'st':
      case 'il':
      case 'cpp':
      case 'python':
        pous.push({ ...common, kind: body.language, lines: lines(body.value) })
        break
      default:
        throw new Error(`Printing ${body.language} is not supported. Deselect ${pou.data.name}.`)
    }
  }
  // Detach graphs and nested option objects from the live store before IPC.
  return structuredClone({
    projectName: state.project.meta.name,
    pous,
    page: selection.page,
    mode: selection.mode,
    pagePolicy: selection.pagePolicy,
  })
}
