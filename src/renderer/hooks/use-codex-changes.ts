import type { CodexMessage } from '@root/types/IPC/codex'
import { useState } from 'react'

import { openPLCStoreBase } from '../store'
import { createCodexEditController } from '../utils/codex-direct-edits'

export function useCodexChanges() {
  const [selected, setSelected] = useState<CodexMessage | null>(null)
  const [controller] = useState(() => createCodexEditController(openPLCStoreBase.getState, openPLCStoreBase.setState))
  const [view, setView] = useState(controller.snapshot)
  const [error, setError] = useState('')
  const [undoError, setUndoError] = useState('')
  return {
    ...view,
    error,
    undoError,
    setError,
    selected,
    setSelected,
    apply: (message: CodexMessage) => {
      setError('')
      setUndoError('')
      const success = controller.apply(message)
      const next = controller.snapshot()
      setView(next)
      if (!success) setError(next.outcomes[message.id].detail)
      return success
    },
    undoLast: () => {
      setError('')
      setUndoError('')
      try {
        controller.undo()
        setView(controller.snapshot())
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not undo changes.'
        setError(message)
        setUndoError(message)
      }
    },
  }
}
