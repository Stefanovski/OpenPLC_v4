import { z } from 'zod'

import { plcBuildRequestSchema } from './build'
import type { PlcContextAttachment } from './context'

export const debugCommandSchema = z
  .object({
    operation: z.enum([
      'connect',
      'observe',
      'disconnect',
      'set-breakpoint',
      'clear-breakpoint',
      'continue',
      'step-into',
      'step-over',
      'step-out',
    ]),
    variables: z.array(z.string().min(1).max(256)).max(24),
    statementId: z.number().int().min(0).max(0xffffffff),
  })
  .strict()
export type PlcDebugCommand = z.infer<typeof debugCommandSchema>
export const isDebugExecution = (operation: PlcDebugCommand['operation']) =>
  !['connect', 'observe', 'disconnect'].includes(operation)
export const debugExecuteSchema = plcBuildRequestSchema
  .extend({
    projectPath: z.string().min(1).max(4096),
    host: z.string().min(1).max(253),
    sessionId: z.string().uuid().nullable(),
    command: debugCommandSchema,
    confirmExecution: z.boolean(),
  })
  .strict()
export type PlcDebugExecute = z.infer<typeof debugExecuteSchema>
export type PlcDebugResult = {
  success: boolean
  sessionId: string | null
  host: string | null
  sampledAt: number
  error?: string
  status?: {
    state: number
    statementId: number
    pouId: number
    instanceId: number
    haltCount: string
    pointCount: string
  }
  values?: Array<{ path: string; type: string; value: string; forced: boolean }>
  stack?: Array<{ pouId: number; instanceId: number; statementId: number }>
  catalog?: {
    variables: Array<{ path: string; type: string }>
    statements: Array<{ id: number; pou: string; line: number }>
    truncated: boolean
  }
  sourceMatch?: 'verified'
  capabilities?: number
  operation?: string
}

export type PlcDebugRequest = { base: PlcContextAttachment; command: PlcDebugCommand }
