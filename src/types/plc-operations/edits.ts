import { z } from 'zod'

import type { PlcContextAttachment } from './context'

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
export const plcPouChangeSchema = z
  .object({
    operation: z.enum(['create', 'update']),
    name: identifier,
    kind: z.enum(['program', 'function-block', 'function']),
    language: z.enum(['st', 'cpp']),
    returnType: z.string().max(64),
    documentation: z.string().max(4000),
    declarations: z.string().max(20000),
    body: z.string().max(60000),
  })
  .strict()
  .refine((change) => change.language !== 'cpp' || change.kind === 'function-block', 'C++ requires a function block')

export const plcEditReplySchema = z
  .object({
    message: z.string().max(24000),
    changes: z.array(plcPouChangeSchema).max(8),
    instances: z.array(z.object({ name: identifier, task: identifier, program: identifier }).strict()).max(8),
  })
  .strict()
export type PlcEditReply = z.infer<typeof plcEditReplySchema>
export type PlcProposal = { base: PlcContextAttachment; reply: PlcEditReply }

export function parsePlcEditReply(text: string): PlcEditReply {
  if (new TextEncoder().encode(text).length > 160000) throw new Error('PLC change proposal exceeds 160 KB.')
  return plcEditReplySchema.parse(JSON.parse(text))
}
