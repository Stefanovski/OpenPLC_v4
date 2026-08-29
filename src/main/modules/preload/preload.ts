// import './splash-screen/index'

import { contextBridge, ipcRenderer } from 'electron'

import type { DeviceConfig } from '../../../types/discovery'
import rendererProcessBridge from '../ipc/renderer'

contextBridge.exposeInMainWorld('bridge', rendererProcessBridge)

export type ElectronHandler = typeof rendererProcessBridge

declare global {
  interface Window {
    bridge: ElectronHandler
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  discoverDevices: () => ipcRenderer.invoke('device-discover'),
  configureDevice: (config: DeviceConfig) => ipcRenderer.invoke('device-configure', config),
  identifyDevice: (mac: string) => ipcRenderer.invoke('device-identify', mac),
})
