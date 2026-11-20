import type { McpRequest } from '@root/types/IPC/mcp'
import type { PlcBuildRequest, PlcBuildResult } from '@root/types/plc-operations/build'
import type { PlcDebugRequest, PlcDebugResult } from '@root/types/plc-operations/debugger'

import { preparePlcBuild } from '../operations/build'
import { buildPlcContext } from '../operations/context'
import { debugTargetKey } from '../operations/debug-target'
import { createPlcEditController } from '../operations/edit-controller'
import { contentKey } from '../operations/edits'
import type { RootState } from '../store'

export function guardMcpRequest(state: RootState, request: McpRequest) {
  if (
    state.project.meta.path !== request.capture.projectPath ||
    contentKey(buildPlcContext(state)) !== contentKey(request.capture.context) ||
    debugTargetKey(state) !== request.capture.target
  )
    throw new Error('Project or target changed since the MCP snapshot. Read context again; nothing was applied.')
}

export function createMcpEditorOperations(
  getState: () => RootState,
  setState: (patch: Partial<RootState>) => void,
  compile: (id: string, data: PlcBuildRequest) => Promise<PlcBuildResult>,
  debug: (id: string, request: { action: PlcDebugRequest; target: string }) => Promise<PlcDebugResult | undefined>,
) {
  const edits = createPlcEditController(getState, setState)
  return {
    undoId: () => edits.snapshot().undoId,
    undo: () => edits.undo(),
    async execute(request: McpRequest, isCurrent: () => boolean) {
      const check = () => {
        if (!isCurrent()) throw new Error('MCP request cancelled.')
        guardMcpRequest(getState(), request)
      }
      check()
      switch (request.action.operation) {
        case 'changes': {
          if (
            !edits.apply({ id: request.id, proposal: { base: request.capture.context, reply: request.action.reply } })
          )
            throw new Error(edits.snapshot().outcomes[request.id].detail)
          return edits.snapshot().outcomes[request.id]
        }
        case 'undo': {
          if (!edits.snapshot().undoId) throw new Error('No MCP change is available to undo.')
          edits.undo()
          return { detail: 'Previous unsaved editor content restored. No save or download.' }
        }
        case 'compile': {
          const result = await compile(request.id, preparePlcBuild(getState()))
          check()
          return result
        }
        case 'debug': {
          const result = await debug(request.id, {
            action: { base: request.capture.context, command: request.action.command },
            target: request.capture.target,
          })
          check()
          if (!result) throw new Error('Debugger operation cancelled.')
          return result
        }
      }
    },
  }
}
