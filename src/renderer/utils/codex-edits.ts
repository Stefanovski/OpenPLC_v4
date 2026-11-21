/** Compatibility exports; implementation belongs to the provider-independent PLC operations. */
export {
  type PlcUndo as CodexUndo,
  contentKey,
  preparePlcChanges as prepareCodexChanges,
  preparePlcUndo as prepareCodexUndo,
} from '../operations/edits'
