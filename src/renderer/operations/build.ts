import type { PlcBuildRequest, PlcBuildResult } from '@root/types/plc-operations/build'
import type { PlcContextAttachment } from '@root/types/plc-operations/context'
import type { PlcEditReply, PlcProposal } from '@root/types/plc-operations/edits'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'

import type { RootState } from '../store'
import { snapshotProject } from '../store/slices/shared/save-project-as'
import { findOutdatedLibraryBlocks } from '../utils/library-block-compatibility'
import { buildPlcContext } from './context'
import { contentKey, preparePlcChanges } from './edits'

export function preparePlcBuild(state: RootState): PlcBuildRequest {
  if (
    state.workspace.isDebuggerVisible ||
    state.workspace.debuggerTargetIp ||
    state.workspace.plcOperationsDebuggerActive
  )
    throw new Error('Disconnect the PLC debugger before starting PLC compilation.')
  if (state.workspace.editingState === 'save-request') throw new Error('Wait for the save operation to finish.')
  return preparePlcProjectData(state)
}

/** Pure snapshot preparation, shared by compilation and debug source verification. */
export function preparePlcProjectData(state: RootState): PlcBuildRequest {
  const board = state.deviceDefinitions.configuration.deviceBoard
  if (state.deviceAvailableOptions.availableBoards.get(board)?.compiler !== 'eurosonic-cli')
    throw new Error('PLC compilation currently supports Eurosonic targets only.')
  const { content } = snapshotProject(state)
  const data = { ...content.projectData.data, pous: content.pous }
  for (const pou of data.pous) {
    if (pou.data.variablesText !== undefined) {
      // The parser ignores text outside VAR blocks. Reject it rather than compile a partial snapshot.
      assertDeclarationBlocks(pou.data.variablesText)
      pou.data.variables = parseIecStringToVariables(pou.data.variablesText, data.pous, data.dataTypes, state.libraries)
      delete pou.data.variablesText
    }
  }
  for (const editor of [...state.editors, state.editor]) {
    if (editor.type === 'plc-resource' && editor.variable.display === 'code' && editor.variable.code !== undefined)
      assertDeclarationBlocks(editor.variable.code)
  }
  if (findOutdatedLibraryBlocks(data, state.libraries).length)
    throw new Error('Update the outdated graphical library interfaces before compiling.')
  return { board, data }
}

function assertDeclarationBlocks(text: string) {
  let inside = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^VAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP|_EXTERNAL|_GLOBAL)?(?:\s+RETAIN)?$/i.test(line)) {
      if (inside) throw new Error('Nested declaration block. Correct declarations before compiling.')
      inside = true
    } else if (/^END_VAR$/i.test(line)) {
      if (!inside) throw new Error('Unexpected END_VAR. Correct declarations before compiling.')
      inside = false
    } else if (!inside) throw new Error('Incomplete declarations. Correct declarations before compiling.')
  }
  if (inside) throw new Error('Missing END_VAR. Correct declarations before compiling.')
}

type BuildDependencies = {
  expectedBase?: PlcContextAttachment
  getState: () => RootState
  compile: (request: PlcBuildRequest) => Promise<PlcBuildResult>
  repair: (context: PlcContextAttachment, diagnostics: string, signal: AbortSignal) => Promise<PlcEditReply>
  report: (attempt: number, result: PlcBuildResult) => void
  status: (message: string) => void
  signal: AbortSignal
}

/** All edits are staged in detached store values. Only the returned final proposal can be applied by the user. */
export async function runPlcBuild(deps: BuildDependencies): Promise<PlcProposal | null> {
  const initial = deps.getState()
  const base = buildPlcContext(initial)
  const originalKey = contentKey(base)
  if (deps.expectedBase && contentKey(deps.expectedBase) !== originalKey)
    throw new Error('The project changed since your chat request. Request compilation of the current project again.')
  let staged = initial
  const changes = new Map<string, PlcEditReply['changes'][number]>()
  const instances = new Map<string, PlcEditReply['instances'][number]>()
  const seen = new Set([originalKey])
  const check = () => {
    if (deps.signal.aborted) throw new Error('Compilation workflow stopped. The project was not changed.')
    const live = deps.getState()
    if (contentKey(buildPlcContext(live)) !== originalKey)
      throw new Error('The project changed during compilation. Results were discarded; your edits were kept.')
    if (
      live.workspace.isDebuggerVisible ||
      live.workspace.plcOperationsDebuggerActive ||
      live.workspace.debuggerTargetIp ||
      live.workspace.editingState === 'save-request'
    )
      throw new Error('Debugger or save operation started. Compilation workflow stopped.')
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    check()
    deps.status(`Compiling temporary snapshot (${attempt}/4)…`)
    const result = await deps.compile(preparePlcBuild(staged))
    check()
    deps.report(attempt, result)
    if (result.success) {
      if (!changes.size && !instances.size) {
        deps.status('Compilation succeeded. No corrections needed; the project was not changed.')
        return null
      }
      const proposal: PlcProposal = {
        base,
        reply: {
          message:
            'Compiler-checked corrections. Review and apply to the editor; then save normally. No PLC download was performed.',
          changes: [...changes.values()],
          instances: [...instances.values()],
        },
      }
      const verified = { ...initial, ...preparePlcChanges(initial, proposal).patch }
      if (contentKey(buildPlcContext(verified)) !== contentKey(buildPlcContext(staged)))
        throw new Error('The combined proposal differs from the compiled snapshot. Nothing was applied.')
      deps.status('Compilation succeeded. Review the corrections below before applying them.')
      return proposal
    }
    if (!result.repairable)
      throw new Error('Compilation stopped. Check the diagnostics; this failure cannot be corrected automatically.')
    if (attempt === 4)
      throw new Error(
        'Compilation still fails after 3 correction rounds. Review the diagnostics. The project was not changed.',
      )
    deps.status(`Correcting compiler errors (${attempt}/3)…`)
    const reply = await deps.repair(buildPlcContext(staged), result.diagnostics, deps.signal)
    check()
    staged = { ...staged, ...preparePlcChanges(staged, { base: buildPlcContext(staged), reply }).patch }
    const key = contentKey(buildPlcContext(staged))
    if (seen.has(key))
      throw new Error('The repair provider repeated an unsuccessful revision. The project was not changed.')
    seen.add(key)
    for (const c of reply.changes) {
      changes.set(c.name, {
        ...c,
        operation: initial.project.data.pous.some((p) => p.data.name === c.name) ? 'update' : 'create',
      })
    }
    for (const i of reply.instances) instances.set(i.name, i)
    if (changes.size > 8 || instances.size > 8)
      throw new Error('Corrections exceed the review limit of 8 POUs/instances.')
  }
  return null
}
