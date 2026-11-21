import { z } from 'zod'

export const ioModuleSchema = z.object({
  slot: z.number().int().min(1).max(7),
  type: z.number().int().min(0).max(63),
  ident: z.number().int().min(0).max(0xffffffff),
  registerCount: z.number().int().min(0).max(65535),
})
export const ioLayoutSchema = z
  .array(ioModuleSchema)
  .length(7)
  .refine((items) => new Set(items.map((i) => i.slot)).size === 7, 'Duplicate slot')
export type IoModule = z.infer<typeof ioModuleSchema>
export type DetectedIoModule = IoModule & { version: number; communicationOk: boolean }
export type IoInventory = { host: string; readAt: number; modules: DetectedIoModule[]; verified: boolean }
export type IoScanResult = { success: true; inventory: IoInventory } | { success: false; error: string }

export function moduleName(type: number): string {
  return ['Empty', 'ESX_DIO8C_01', 'ESX_AI4C_01', 'ESX_AO4C_01'][type] ?? `Unknown type ${type}`
}
export function decodeIoModule(slot: number, words: number[]): DetectedIoModule {
  if (words.length !== 6 || words.some((v) => !Number.isInteger(v) || v < 0 || v > 65535))
    throw new Error('Invalid inventory registers')
  const [version, low, high, registerCount, communication, type] = words
  if (type > 63 || communication > 1 || (type === 0 && words.some((v) => v !== 0)) || (type !== 0 && version !== 1))
    throw new Error(`Unsupported or invalid inventory in slot ${slot}`)
  return {
    ...ioModuleSchema.parse({ slot, type, ident: low + high * 65536, registerCount }),
    version,
    communicationOk: communication === 1,
  }
}
export function compareIoModule(
  expected: IoModule | undefined,
  actual: DetectedIoModule | undefined,
  fresh: boolean,
): string {
  if (!fresh || !actual) return 'Not verified'
  if (actual.type !== 0 && !actual.communicationOk) return 'Communication lost'
  if (!expected) return 'Not configured'
  if (!expected.type && actual.type) return 'Additional module'
  if (expected.type && !actual.type) return 'Module missing'
  if (
    expected.type !== actual.type ||
    expected.ident !== actual.ident ||
    expected.registerCount !== actual.registerCount
  )
    return 'Different module'
  return 'Match'
}
export function ioChannels(slot: number, type: number): { channel: number; input?: string; output?: string }[] {
  const digital = 100 + (slot - 1) * 20
  const analog = 1000 + (slot - 1) * 100
  if (type === 1)
    return Array.from({ length: 8 }, (_, i) => ({
      channel: i + 1,
      input: `%IX${digital}.${i}`,
      output: `%QX${digital}.${i}`,
    }))
  if (type === 2 || type === 3)
    return Array.from({ length: 4 }, (_, i) => ({
      channel: i + 1,
      input: `%IW${analog + i}`,
      ...(type === 3 ? { output: `%QW${analog + i}` } : {}),
    }))
  return []
}

export type IoRescanResult =
  | { success: true; inventory: IoInventory; addedSlots: number[]; plcOnlySlots: number[] }
  | { success: false; error: string }
