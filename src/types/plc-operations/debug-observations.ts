import { z } from 'zod'

export const PLC_DEBUG_FRESH_MS = 5000
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const label = z.string().max(256)
const location = z
  .object({
    statementId: z.number().int().nonnegative(),
    pou: label.nullable(),
    instance: label.nullable(),
    line: z.number().int().nonnegative().nullable(),
  })
  .strict()

/** Observations only: there are deliberately no execution or write commands in this protocol. */
export const plcDebugSnapshotSchema = z
  .object({
    version: z.literal(1),
    capturedAt: time,
    debuggerActive: z.boolean(),
    sessionMatches: z.boolean(),
    target: label.nullable(),
    sourceMatch: z.literal('unverified'),
    unsavedChanges: z.boolean(),
    localBuildId: label.nullable(),
    status: z
      .object({
        sampledAt: time,
        stateCode: z.number().int().nonnegative(),
        haltCount: label,
        pointCount: label,
        location,
      })
      .strict()
      .nullable(),
    callStack: z
      .object({ sampledAt: time, haltCount: label, frames: z.array(location).max(32) })
      .strict()
      .nullable(),
    variables: z
      .array(
        z
          .object({
            key: label,
            index: z.number().int().nonnegative(),
            value: z.string().max(512).nullable(),
            sampledAt: time.nullable(),
            forced: z.boolean().nullable(),
          })
          .strict(),
      )
      .max(64),
    omittedVariables: z.number().int().nonnegative(),
    cacheLimited: z.boolean(),
    selectedInstances: z.array(z.object({ pou: label, instance: label }).strict()).max(32),
  })
  .strict()

export type PlcDebugSnapshot = z.infer<typeof plcDebugSnapshotSchema>
export function describePlcDebug(input: PlcDebugSnapshot, now = Date.now()) {
  const snapshot = plcDebugSnapshotSchema.parse(input)
  const freshness = (sampledAt: number | null) => {
    if (!snapshot.debuggerActive || !snapshot.sessionMatches || sampledAt === null) return 'unavailable'
    if (sampledAt > snapshot.capturedAt || snapshot.capturedAt > now) return 'invalid-time'
    return now - sampledAt <= PLC_DEBUG_FRESH_MS ? 'recent-sample' : 'stale'
  }
  return {
    ...snapshot,
    evaluatedAt: now,
    statusFreshness: freshness(snapshot.status?.sampledAt ?? null),
    callStackFreshness:
      snapshot.status?.stateCode === 1 && snapshot.status.haltCount === snapshot.callStack?.haltCount
        ? freshness(snapshot.callStack?.sampledAt ?? null)
        : 'unavailable',
    variables: snapshot.variables.map((variable) => ({
      ...variable,
      freshness: variable.value === null || variable.value === 'ERR' ? 'unavailable' : freshness(variable.sampledAt),
    })),
  }
}
