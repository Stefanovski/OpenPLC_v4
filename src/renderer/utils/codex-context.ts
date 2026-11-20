import { CodexContext, CodexContextAttachment, parseCodexContext } from '@root/types/IPC/codex-context'

import type { RootState } from '../store'
import { getIoObservation, IoObservation } from './io-observation'

type ContextState = Pick<
  RootState,
  | 'project'
  | 'editor'
  | 'editors'
  | 'fbdFlows'
  | 'ladderFlows'
  | 'deviceDefinitions'
  | 'deviceAvailableOptions'
  | 'workspace'
>

/** Pure projection: no saving, parsing declarations, compiler, network request or store mutation. */
export function buildCodexContext(
  state: ContextState,
  observation: IoObservation | undefined = getIoObservation(),
  now = Date.now(),
): CodexContextAttachment {
  const editors = new Map([...state.editors, state.editor].map((editor) => [editor.meta.name, editor]))
  const resourceEditor = [...editors.values()].find((editor) => editor.type === 'plc-resource')
  const globalsText =
    resourceEditor?.type === 'plc-resource' && resourceEditor.variable.display === 'code'
      ? resourceEditor.variable.code
      : undefined
  const config = state.deviceDefinitions.configuration
  const host =
    config.runtimeIpAddress ||
    config.communicationPort ||
    config.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress
  const board = state.deviceAvailableOptions.availableBoards.get(config.deviceBoard)
  const matches =
    observation?.projectPath === state.project.meta.path &&
    observation.board === config.deviceBoard &&
    observation.configuredHost === host
  const resource = state.project.data.configuration.resource
  const context: CodexContext = {
    version: 1,
    capturedAt: now,
    project: {
      name: state.project.meta.name,
      activeEditor: state.editor.meta.name,
      editingState: state.workspace.editingState,
      pous: state.project.data.pous.map((pou) => {
        const editor = editors.get(pou.data.name)
        const raw =
          (editor?.type === 'plc-textual' || editor?.type === 'plc-graphical') && editor.variable.display === 'code'
            ? editor.variable.code
            : undefined
        const text = raw ?? pou.data.variablesText
        const body = pou.data.body
        const value =
          body.language === 'fbd'
            ? state.fbdFlows.find((flow) => flow.name === pou.data.name) ?? body.value
            : body.language === 'ld'
              ? state.ladderFlows.find((flow) => flow.name === pou.data.name) ?? body.value
              : body.value
        return {
          name: pou.data.name,
          kind: pou.type,
          language: body.language,
          documentation: pou.data.documentation,
          ...(pou.type === 'function' ? { returnType: pou.data.returnType } : {}),
          declarations:
            text !== undefined
              ? { source: 'raw-text' as const, text }
              : { source: 'table' as const, variables: pou.data.variables },
          body: value,
        }
      }),
      dataTypes: state.project.data.dataTypes,
      resource: {
        globals:
          globalsText !== undefined
            ? { source: 'raw-text', text: globalsText }
            : { source: 'table', variables: resource.globalVariables },
        tasks: resource.tasks,
        instances: resource.instances,
      },
    },
    device: {
      board: config.deviceBoard,
      compiler: board?.compiler ?? null,
      coreVersion: board?.coreVersion ?? null,
      pinMapping: state.deviceDefinitions.pinMapping.pins,
    },
    io: {
      configuredHost: host,
      expected: config.ioLayout ?? null,
      observation: matches
        ? { state: observation.state, requestedHost: observation.requestedHost, inventory: observation.inventory }
        : null,
    },
  }
  // Serialize only this allowlist; runtime JWTs, credentials, paths and debugger state are not included.
  const snapshot = JSON.stringify(context)
  parseCodexContext(snapshot)
  return { projectPath: state.project.meta.path, snapshot }
}
