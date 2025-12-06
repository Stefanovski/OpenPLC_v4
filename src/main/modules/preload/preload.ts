// import './splash-screen/index'

import { contextBridge, ipcRenderer} from 'electron'

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
  configureDevice: (config: any) => ipcRenderer.invoke('device-configure', config),
});