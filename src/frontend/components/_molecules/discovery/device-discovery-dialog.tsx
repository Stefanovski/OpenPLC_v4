import { InputWithRef, Label } from '@root/renderer/components/_atoms' // Pfad ggf. anpassen
import { INPUT_STYLES } from '@data/constants/device-styles'

import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@root/renderer/components/_atoms/dialog/dialogs' // Pfad ggf. anpassen
import type { DeviceInfo } from '@root/types/discovery'
import { useState } from 'react'

type DiscoveryDialogProps = {
  onSelectIp: (ip: string) => void
}

export const DeviceDiscoveryDialog = ({ onSelectIp }: DiscoveryDialogProps) => {
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null)

  // Lokaler State für das Formular (zum Ändern der IP/DHCP)
  const [configIp, setConfigIp] = useState('')
  const [configDhcp, setConfigDhcp] = useState(false)

  // Scan starten
  const handleScan = async () => {
    setScanning(true)
    setDevices([])
    setSelectedDevice(null)
    try {
      // Zugriff auf die Bridge, die wir gebaut haben
      const results = await window.electronAPI.discoverDevices()
      setDevices(results)
    } catch (err) {
      console.error('Scan failed:', err)
    } finally {
      setScanning(false)
    }
  }

  // Gerät aus der Liste auswählen
  const handleSelect = (dev: DeviceInfo) => {
    setSelectedDevice(dev)
    setConfigIp(dev.ip)
    setConfigDhcp(false) // Standardannahme, da wir DHCP Status nicht auslesen können im Broadcast
  }

  // IP in das Hauptformular übernehmen
  const handleApplyToForm = () => {
    if (selectedDevice) {
      onSelectIp(selectedDevice.ip) // Oder configIp, wenn man die geänderte will
      setOpen(false)
    }
  }

  // Konfiguration an das Gerät senden (via UDP)
  const handleConfigureDevice = async () => {
    if (!selectedDevice) return
    
    try {
      const success = await window.electronAPI.configureDevice({
        mac: selectedDevice.mac,
        targetIp: selectedDevice.ip,
        dhcp: configDhcp,
        newIp: configIp,
        netmask: "255.255.255.0", // Hardcoded oder via UI erweiterbar
        gateway: "0.0.0.0",       // Hardcoded oder via UI erweiterbar
        hostname: selectedDevice.hostname
      })

      if (success) {
        alert("Configuration sent!")
        handleScan() // Liste aktualisieren
      }
    } catch (e) {
      alert("Error while sending the configuration.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
        type="button"
        onClick={() => handleScan()}
        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-md text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-2 dark:bg-neutral-700 dark:text-white dark:hover:bg-neutral-600"
        >
        Search Devices
        </button>
     </DialogTrigger>
      
      <DialogContent className='max-w-3xl bg-white dark:bg-neutral-900 text-neutral-950 dark:text-white'>
        <DialogHeader>
          <DialogTitle>Found Eurosonic Devices</DialogTitle>
        </DialogHeader>

        <div className='flex gap-6 h-[400px] mt-4'>
          {/* Linke Spalte: Liste der Geräte */}
          <div className='flex-1 flex flex-col border-r border-neutral-200 dark:border-neutral-700 pr-4'>
            <div className='flex justify-between items-center mb-2 pb-2 border-b border-neutral-100 dark:border-neutral-800'>
              <span className='text-xs font-bold uppercase text-neutral-500'>Liste ({devices.length})</span>
              <button 
                onClick={handleScan} 
                disabled={scanning}
                className='text-xs text-blue-600 hover:underline disabled:opacity-50'
              >
                {scanning ? 'Searching ...' : 'Update'}
              </button>
            </div>
            
            <div className='flex-1 overflow-y-auto space-y-2'>
              {devices.length === 0 && !scanning && (
                <p className='text-sm text-neutral-400 text-center mt-10'>No devices found.</p>
              )}
              
              {devices.map((dev) => (
                <div 
                  key={dev.mac}
                  onClick={() => handleSelect(dev)}
                  className={`
                    p-3 rounded-md cursor-pointer border text-sm transition-colors
                    ${selectedDevice?.mac === dev.mac 
                      ? 'bg-blue-50 border-blue-500 dark:bg-blue-900/20 dark:border-blue-400' 
                      : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }
                  `}
                >
                  <div className='font-bold'>{dev.hostname}</div>
                  <div className='flex justify-between text-xs text-neutral-500 mt-1'>
                    <span>{dev.ip}</span>
                    <span className='font-mono'>{dev.mac}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rechte Spalte: Details & Aktionen */}
          <div className='flex-1 flex flex-col'>
            {selectedDevice ? (
              <div className='flex flex-col h-full gap-4'>
                <div className='bg-neutral-50 dark:bg-neutral-800 p-3 rounded text-sm mb-2'>
                  <h4 className='font-bold mb-1'>Device Information</h4>
                  <p className='text-xs text-neutral-500'>Revision: {selectedDevice.revision}</p>
                  <p className='text-xs text-neutral-500'>{selectedDevice.info}</p>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center gap-2'>
                    <input 
                      type="checkbox" 
                      id="dhcp-check"
                      className="rounded border-gray-300"
                      checked={configDhcp} 
                      onChange={e => setConfigDhcp(e.target.checked)} 
                    />
                    <Label htmlFor="dhcp-check" className="cursor-pointer">DHCP</Label>
                  </div>

                  {!configDhcp && (
                    <div className='space-y-1'>
                      <Label className='text-xs'>IP Address      </Label>
                      <InputWithRef 
                        value={configIp} 
                        onChange={e => setConfigIp(e.target.value)} 
                        // HIER SIND DIE NEUEN STYLES:
                        className={INPUT_STYLES.default}
                        placeholder="xxx.xxx.xxx.xxx"
                        />
                    </div>
                    )}

                    <button 
                    type="button"
                    onClick={handleConfigureDevice}
                    className="w-full px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-md text-sm font-medium transition-colors mt-2"
                    >
                    Send Configuration
                    </button>
                </div>

                <div className='mt-auto pt-4 border-t border-neutral-200 dark:border-neutral-700'>
                    <button 
                    type="button"
                    onClick={handleApplyToForm}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium transition-colors"
                    >
                    Use this device IP
                    </button>
                </div>
              </div>
            ) : (
              <div className='flex h-full items-center justify-center text-neutral-400 text-sm'>
                <p>Select a device,<br/>to enter changes.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}