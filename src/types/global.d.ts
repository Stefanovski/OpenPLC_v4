// src/renderer/types/global.d.ts
import { DeviceConfig, DeviceInfo } from './discovery'
import { TelnetEvent, TelnetOperationResult } from './telnet'

export {}

declare global {
  interface Window {
    electronAPI: {
      discoverDevices: () => Promise<DeviceInfo[]>
      configureDevice: (config: DeviceConfig) => Promise<boolean>
      identifyDevice: (mac: string) => Promise<boolean>
      telnetConnect: (host: string) => Promise<TelnetOperationResult>
      telnetDisconnect: () => Promise<TelnetOperationResult>
      telnetWrite: (data: string) => Promise<TelnetOperationResult>
      onTelnetEvent: (callback: (event: TelnetEvent) => void) => () => void
    }
  }
}
