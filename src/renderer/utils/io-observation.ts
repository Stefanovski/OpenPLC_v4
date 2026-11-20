import type { IoInventory } from '@root/types/PLC/io-inventory'

export type IoObservation = {
  projectPath: string
  board: string
  configuredHost: string
  requestedHost: string
  state: 'reading' | 'success' | 'failed'
  inventory?: IoInventory
}

// Session-only observation, separate from the persisted expected IO layout.
let observation: IoObservation | undefined
let generation = 0
export function getIoObservation(): IoObservation | undefined {
  return observation ? structuredClone(observation) : undefined
}
export function beginIoObservation(value: Omit<IoObservation, 'state'>): number {
  observation = structuredClone({ ...value, state: 'reading' })
  return ++generation
}
export function finishIoObservation(id: number, inventory?: IoInventory) {
  if (id !== generation || !observation) return
  observation.state = inventory ? 'success' : 'failed'
  if (inventory) observation.inventory = structuredClone(inventory)
}
export function cancelIoObservation(id: number) {
  if (id === generation && observation?.state === 'reading') observation.state = 'failed'
}
export function clearIoObservation(projectPath: string) {
  if (observation?.projectPath !== projectPath) return
  generation++
  observation = undefined
}
