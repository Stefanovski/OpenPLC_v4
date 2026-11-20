import type { CodexBuildRequest, CodexBuildResult } from '@root/types/IPC/codex-build'
import type { CodexContextAttachment } from '@root/types/IPC/codex-context'
import type { CodexEditReply, CodexProposal } from '@root/types/IPC/codex-edits'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'

import type { RootState } from '../store'
import { snapshotProject } from '../store/slices/shared/save-project-as'
import { buildCodexContext } from './codex-context'
import { contentKey, prepareCodexChanges } from './codex-edits'
import { findOutdatedLibraryBlocks } from './library-block-compatibility'

export function prepareCodexBuild(state: RootState): CodexBuildRequest {
  if (state.workspace.isDebuggerVisible || state.workspace.debuggerTargetIp || state.workspace.codexDebuggerActive)
    throw new Error('Disconnect the PLC debugger before starting Codex compilation.')
  if (state.workspace.editingState === 'save-request') throw new Error('Wait for the save operation to finish.')
  return prepareCodexProjectData(state)
}

/** Pure snapshot preparation, shared by compilation and debug source verification. */
export function prepareCodexProjectData(state: RootState): CodexBuildRequest {
  const board = state.deviceDefinitions.configuration.deviceBoard
  if (state.deviceAvailableOptions.availableBoards.get(board)?.compiler !== 'eurosonic-cli')
    throw new Error('Codex compilation currently supports Eurosonic targets only.')
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
  expectedBase?: CodexContextAttachment
  getState: () => RootState
  compile: (request: CodexBuildRequest) => Promise<CodexBuildResult>
  repair: (context: CodexContextAttachment, diagnostics: string, signal: AbortSignal) => Promise<CodexEditReply>
  report: (attempt: number, result: CodexBuildResult) => void
  status: (message: string) => void
  signal: AbortSignal
}

/** All edits are staged in detached store values. Only the returned final proposal can be applied by the user. */
export async function runCodexBuild(deps: BuildDependencies): Promise<CodexProposal | null> {
  const initial = deps.getState()
  const base = buildCodexContext(initial)
  const originalKey = contentKey(base)
  if (deps.expectedBase && contentKey(deps.expectedBase) !== originalKey)
    throw new Error('The project changed since your chat request. Ask Codex to compile the current project again.')
  let staged = initial
  const changes = new Map<string, CodexEditReply['changes'][number]>()
  const instances = new Map<string, CodexEditReply['instances'][number]>()
  const seen = new Set([originalKey])
  const check = () => {
    if (deps.signal.aborted) throw new Error('Compilation workflow stopped. The project was not changed.')
    const live = deps.getState()
    if (contentKey(buildCodexContext(live)) !== originalKey)
      throw new Error('The project changed during compilation. Results were discarded; your edits were kept.')
    if (
      live.workspace.isDebuggerVisible ||
      live.workspace.codexDebuggerActive ||
      live.workspace.debuggerTargetIp ||
      live.workspace.editingState === 'save-request'
    )
      throw new Error('Debugger or save operation started. Compilation workflow stopped.')
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    check()
    deps.status(`Compiling temporary snapshot (${attempt}/4)…`)
    const result = await deps.compile(prepareCodexBuild(staged))
    check()
    deps.report(attempt, result)
    if (result.success) {
      if (!changes.size && !instances.size) {
        deps.status('Compilation succeeded. No corrections needed; the project was not changed.')
        return null
      }
      const proposal: CodexProposal = {
        base,
        reply: {
          message:
            'Compiler-checked corrections. Review and apply to the editor; then save normally. No PLC download was performed.',
          changes: [...changes.values()],
          instances: [...instances.values()],
        },
      }
      const verified = { ...initial, ...prepareCodexChanges(initial, proposal).patch }
      if (contentKey(buildCodexContext(verified)) !== contentKey(buildCodexContext(staged)))
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
    deps.status(`Codex is correcting compiler errors (${attempt}/3)…`)
    const reply = await deps.repair(buildCodexContext(staged), result.diagnostics, deps.signal)
    check()
    staged = { ...staged, ...prepareCodexChanges(staged, { base: buildCodexContext(staged), reply }).patch }
    const key = contentKey(buildCodexContext(staged))
    if (seen.has(key)) throw new Error('Codex repeated an unsuccessful revision. The project was not changed.')
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
