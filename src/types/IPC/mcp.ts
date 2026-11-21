import { z } from 'zod'

import { plcContextAttachmentSchema } from '../plc-operations/context'
import { plcDebugSnapshotSchema } from '../plc-operations/debug-observations'
import { debugCommandSchema } from '../plc-operations/debugger'
import { plcEditReplySchema } from '../plc-operations/edits'

const snapshot = { snapshotId: z.string().uuid() }
export const mcpActionSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('changes'), ...snapshot, reply: plcEditReplySchema }).strict(),
  z.object({ operation: z.literal('undo'), ...snapshot }).strict(),
  z.object({ operation: z.literal('compile'), ...snapshot }).strict(),
  z.object({ operation: z.literal('debug'), ...snapshot, command: debugCommandSchema }).strict(),
])
export type McpAction = z.infer<typeof mcpActionSchema>
export const mcpCaptureSchema = z
  .object({
    projectPath: z.string().min(1).max(4096),
    target: z.string().max(16000),
    context: plcContextAttachmentSchema,
    debugger: plcDebugSnapshotSchema,
  })
  .strict()
export type McpCapture = z.infer<typeof mcpCaptureSchema>
export type McpRequest = { id: string; action: McpAction; capture: McpCapture; createdAt: number }
export type McpResult = {
  id: string
  operation: McpAction['operation']
  status: 'review-required' | 'executing' | 'completed' | 'rejected' | 'cancelled' | 'failed'
  detail: string
  value?: unknown
}
export type McpState = {
  enabled: boolean
  endpoint: string | null
  token: string | null
  pending: McpRequest | null
  results: McpResult[]
}
export const emptyMcpState: McpState = { enabled: false, endpoint: null, token: null, pending: null, results: [] }
