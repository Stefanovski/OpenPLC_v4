import { z } from 'zod'

import { PLCProjectSchema } from '../PLC/open-plc'

/** No source path, executable, upload flag or target credentials cross this boundary. */
export const codexBuildRequestSchema = z
  .object({
    board: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/),
    data: PLCProjectSchema.shape.data,
  })
  .strict()
export type CodexBuildRequest = z.infer<typeof codexBuildRequestSchema>
export type CodexBuildResult = {
  success: boolean
  diagnostics: string
  repairable: boolean
}
