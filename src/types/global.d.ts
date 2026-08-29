// src/renderer/types/global.d.ts
import { DeviceConfig, DeviceInfo } from './discovery'

export {}

declare global {
  interface Window {
    electronAPI: {
      discoverDevices: () => Promise<DeviceInfo[]>
      configureDevice: (config: DeviceConfig) => Promise<boolean>
      identifyDevice: (mac: string) => Promise<boolean>
    }
  }
}
