import { defaultPlcAiSettings, PlcAiSettings } from '@root/types/plc-operations/ai-settings'
import { create } from 'zustand'

// Session-scoped and per project: shared by the side panel and MCP, never written into PLC files.
export const plcAiSettingsStore = create<{ projects: Record<string, PlcAiSettings> }>(() => ({ projects: {} }))
export const getPlcAiSettings = (path: string) => plcAiSettingsStore.getState().projects[path] ?? defaultPlcAiSettings
export function updatePlcAiSettings(path: string, patch: Partial<PlcAiSettings>) {
  plcAiSettingsStore.setState((state) => ({
    projects: { ...state.projects, [path]: { ...getPlcAiSettings(path), ...patch } },
  }))
}
export const usePlcAiSettings = (path: string) =>
  plcAiSettingsStore((state) => state.projects[path] ?? defaultPlcAiSettings)
