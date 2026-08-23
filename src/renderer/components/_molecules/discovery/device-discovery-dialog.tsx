import { INPUT_STYLES } from '@data/constants/device-styles'
import { InputWithRef, Label } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules/modal'
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
  const [configIp, setConfigIp] = useState('')
  const [configDhcp, setConfigDhcp] = useState(false)

  const handleScan = async () => {
    setScanning(true)
    setDevices([])
    setSelectedDevice(null)
    try {
      const results = await window.electronAPI.discoverDevices()
      setDevices(results)
    } catch (error) {
      console.error('Scan failed:', error)
    } finally {
      setScanning(false)
    }
  }

  const handleSelect = (device: DeviceInfo) => {
    setSelectedDevice(device)
    setConfigIp(device.ip)
    setConfigDhcp(false)
  }

  const handleApplyToForm = () => {
    if (!selectedDevice) return
    onSelectIp(selectedDevice.ip)
    setOpen(false)
  }

  const handleConfigureDevice = async () => {
    if (!selectedDevice) return

    try {
      const success = await window.electronAPI.configureDevice({
        mac: selectedDevice.mac,
        targetIp: selectedDevice.ip,
        dhcp: configDhcp,
        newIp: configIp,
        netmask: '255.255.255.0',
        gateway: '0.0.0.0',
        hostname: selectedDevice.hostname,
      })

      if (success) {
        alert('Configuration sent!')
        void handleScan()
      }
    } catch (_error) {
      alert('Error while sending the configuration.')
    }
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <button
          type='button'
          onClick={() => void handleScan()}
          className='flex items-center gap-2 whitespace-nowrap rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700'
        >
          Search Devices
        </button>
      </ModalTrigger>

      <ModalContent
        onClose={() => setOpen(false)}
        className='h-[550px] w-[850px] max-w-[calc(100vw-2rem)] select-none gap-4 rounded-lg p-6 text-neutral-950 dark:text-neutral-100'
      >
        <ModalTitle className='text-lg font-semibold text-neutral-950 dark:text-white'>
          Found Eurosonic Devices
        </ModalTitle>

        <div className='mt-2 flex h-[400px] gap-6'>
          <div className='flex flex-1 flex-col border-r border-neutral-200 pr-4 dark:border-neutral-800'>
            <div className='mb-2 flex items-center justify-between border-b border-neutral-200 pb-2 dark:border-neutral-800'>
              <span className='text-xs font-bold uppercase text-neutral-500 dark:text-neutral-400'>
                Devices ({devices.length})
              </span>
              <button
                type='button'
                onClick={() => void handleScan()}
                disabled={scanning}
                className='text-xs font-medium text-brand hover:underline disabled:opacity-50'
              >
                {scanning ? 'Searching ...' : 'Update'}
              </button>
            </div>

            <div className='flex-1 space-y-2 overflow-y-auto'>
              {devices.length === 0 && !scanning && (
                <p className='mt-10 text-center text-sm text-neutral-400'>No devices found.</p>
              )}

              {devices.map((device) => (
                <button
                  type='button'
                  key={device.mac}
                  onClick={() => handleSelect(device)}
                  className={`w-full cursor-pointer rounded-md border p-3 text-left text-sm transition-colors ${
                    selectedDevice?.mac === device.mac
                      ? 'bg-brand/10 border-brand'
                      : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-850'
                  }`}
                >
                  <div className='font-bold'>{device.hostname}</div>
                  <div className='mt-1 flex justify-between text-xs text-neutral-500 dark:text-neutral-400'>
                    <span>{device.ip}</span>
                    <span className='font-mono'>{device.mac}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className='flex flex-1 flex-col'>
            {selectedDevice ? (
              <div className='flex h-full flex-col gap-4'>
                <div className='mb-2 rounded-md bg-neutral-100 p-3 text-sm dark:bg-neutral-850'>
                  <h4 className='mb-1 font-bold'>Device Information</h4>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>Revision: {selectedDevice.revision}</p>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>{selectedDevice.info}</p>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      id='dhcp-check'
                      className='h-4 w-4 rounded border-neutral-300 accent-brand'
                      checked={configDhcp}
                      onChange={(event) => setConfigDhcp(event.target.checked)}
                    />
                    <Label htmlFor='dhcp-check' className='cursor-pointer'>
                      DHCP
                    </Label>
                  </div>

                  {!configDhcp && (
                    <div className='space-y-1'>
                      <Label className='text-xs'>IP Address</Label>
                      <InputWithRef
                        value={configIp}
                        onChange={(event) => setConfigIp(event.target.value)}
                        className={INPUT_STYLES.default}
                        placeholder='xxx.xxx.xxx.xxx'
                      />
                    </div>
                  )}

                  <button
                    type='button'
                    onClick={() => void handleConfigureDevice()}
                    className='mt-2 w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark'
                  >
                    Send Configuration
                  </button>
                </div>

                <div className='mt-auto border-t border-neutral-200 pt-4 dark:border-neutral-800'>
                  <button
                    type='button'
                    onClick={handleApplyToForm}
                    className='w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-medium-dark'
                  >
                    Use this device IP
                  </button>
                </div>
              </div>
            ) : (
              <div className='flex h-full items-center justify-center text-center text-sm text-neutral-400'>
                <p>
                  Select a device,
                  <br />
                  to enter changes.
                </p>
              </div>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
