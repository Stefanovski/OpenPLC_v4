import type { CodexDebugAction } from '@root/types/IPC/codex-debug-control'
import type { PlcOperationTransport } from '@root/types/plc-operations/transport'
import { useRef } from 'react'

import { usePlcDebugger } from '../operations/use-debugger'

const transport: Pick<PlcOperationTransport, 'debugExecute' | 'debugClose'> = {
  debugExecute: (request) => window.bridge.codexDebugExecute(request),
  debugClose: () => window.bridge.codexDebugClose(),
}

/** Codex supplies transport and completion routing; all execution guards belong to OpenPLC. */
export function useCodexDebugger(projectPath: string, afterResult: (model: string) => void) {
  const feedback = useRef(afterResult)
  feedback.current = afterResult
  const controller = usePlcDebugger(projectPath, transport, 'codex')
  return {
    ...controller,
    request: ({ action, target }: { action: CodexDebugAction; target: string }) =>
      controller.request({
        action: { base: action.base, command: action.command },
        target,
        onResult: () => feedback.current(action.model),
      }),
  }
}
