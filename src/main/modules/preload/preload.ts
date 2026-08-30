// import './splash-screen/index'

import { contextBridge, ipcRenderer } from 'electron'

import type { DeviceConfig } from '../../../types/discovery'
import type { TelnetEvent } from '../../../types/telnet'
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
  telnetConnect: (host: string) => ipcRenderer.invoke('telnet:connect', host),
  telnetDisconnect: () => ipcRenderer.invoke('telnet:disconnect'),
  telnetWrite: (data: string) => ipcRenderer.invoke('telnet:write', data),
  onTelnetEvent: (callback: (event: TelnetEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: TelnetEvent) => callback(event)
    ipcRenderer.on('telnet:event', listener)
    return () => ipcRenderer.removeListener('telnet:event', listener)
  },
})
