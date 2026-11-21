/** Compatibility exports; implementation belongs to the provider-independent PLC operations. */
export {
  type PlcContext as CodexContext,
  type PlcContextAttachment as CodexContextAttachment,
  plcContextAttachmentSchema as codexContextAttachmentSchema,
  plcContextSchema as codexContextSchema,
  describePlcContext as describeCodexContext,
  MAX_PLC_CONTEXT_BYTES as MAX_CODEX_CONTEXT_BYTES,
  parsePlcContext as parseCodexContext,
} from '../plc-operations/context'
