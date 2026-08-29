import { INPUT_STYLES } from '@data/constants/device-styles'
import { EyeOpenIcon } from '@radix-ui/react-icons'
import { InputWithRef, Label } from '@root/renderer/components/_atoms'
import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules/modal'
import type { DeviceInfo } from '@root/types/discovery'
import { useState } from 'react'

type DiscoveryDialogProps = {
  onSelectIp: (ip: string) => void
}

const DEFAULT_NETMASK = '255.255.255.0'
const DEFAULT_GATEWAY = '0.0.0.0'

const parseIpv4Address = (value: string): number[] | null => {
  const parts = value.trim().split('.')
  if (parts.length !== 4) return null

  const octets = parts.map((part) => Number(part))
  if (parts.some((part) => !/^\d{1,3}$/.test(part)) || octets.some((octet) => octet < 0 || octet > 255)) {
    return null
  }
  return octets
}

const validateStaticNetworkConfiguration = (ipValue: string, netmaskValue: string, gatewayValue: string) => {
  const ip = parseIpv4Address(ipValue)
  const netmask = parseIpv4Address(netmaskValue)
  const gateway = parseIpv4Address(gatewayValue)
  if (!ip) return 'Please enter a valid IP address.'
  if (!netmask) return 'Please enter a valid subnet mask.'
  if (!gateway) return 'Please enter a valid gateway address.'

  const maskBits = netmask.map((octet) => octet.toString(2).padStart(8, '0')).join('')
  const firstHostBit = maskBits.indexOf('0')
  if (firstHostBit <= 0 || maskBits.slice(firstHostBit).includes('1') || 32 - firstHostBit < 2) {
    return 'The subnet mask must be contiguous and leave at least two host bits.'
  }

  if (ip[0] === 0 || ip[0] >= 224) return 'The IP address is not a valid unicast address.'

  const network = ip.map((octet, index) => octet & netmask[index])
  const broadcast = network.map((octet, index) => octet | (~netmask[index] & 0xff))
  const isSameAddress = (left: number[], right: number[]) => left.every((octet, index) => octet === right[index])
  if (isSameAddress(ip, network) || isSameAddress(ip, broadcast)) {
    return 'The IP address must not be the network or broadcast address.'
  }

  const gatewayDisabled = gateway.every((octet) => octet === 0)
  if (!gatewayDisabled) {
    const gatewayNetwork = gateway.map((octet, index) => octet & netmask[index])
    if (
      !isSameAddress(gatewayNetwork, network) ||
      isSameAddress(gateway, network) ||
      isSameAddress(gateway, broadcast)
    ) {
      return 'The gateway must be 0.0.0.0 or a valid host in the configured subnet.'
    }
  }

  return null
}

export const DeviceDiscoveryDialog = ({ onSelectIp }: DiscoveryDialogProps) => {
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null)
  const [configIp, setConfigIp] = useState('')
  const [configNetmask, setConfigNetmask] = useState(DEFAULT_NETMASK)
  const [configGateway, setConfigGateway] = useState(DEFAULT_GATEWAY)
  const [configDhcp, setConfigDhcp] = useState(false)
  const [identifyingMac, setIdentifyingMac] = useState<string | null>(null)

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
    setConfigNetmask(DEFAULT_NETMASK)
    setConfigGateway(DEFAULT_GATEWAY)
    setConfigDhcp(false)
  }

  const handleApplyToForm = () => {
    if (!selectedDevice) return
    onSelectIp(selectedDevice.ip)
    setOpen(false)
  }

  const handleConfigureDevice = async () => {
    if (!selectedDevice) return

    if (!configDhcp) {
      const validationError = validateStaticNetworkConfiguration(configIp, configNetmask, configGateway)
      if (validationError) {
        alert(validationError)
        return
      }
    }

    try {
      const success = await window.electronAPI.configureDevice({
        mac: selectedDevice.mac,
        targetIp: selectedDevice.ip,
        dhcp: configDhcp,
        newIp: configDhcp ? '0.0.0.0' : configIp.trim(),
        netmask: configDhcp ? '0.0.0.0' : configNetmask.trim(),
        gateway: configDhcp ? '0.0.0.0' : configGateway.trim(),
        hostname: selectedDevice.hostname,
      })

      if (success) {
        alert('Configuration sent!')
        void handleScan()
      } else {
        alert('The generator rejected the network configuration or did not acknowledge it.')
      }
    } catch (_error) {
      alert('Error while sending the configuration.')
    }
  }

  const handleIdentifyDevice = async (device: DeviceInfo) => {
    setIdentifyingMac(device.mac)
    try {
      const success = await window.electronAPI.identifyDevice(device.mac)
      if (!success) {
        alert('The generator did not acknowledge the identification request.')
      }
    } catch (_error) {
      alert('Error while identifying the generator.')
    } finally {
      setIdentifyingMac(null)
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
                <div
                  key={device.mac}
                  className={`flex w-full items-stretch rounded-md border text-sm transition-colors ${
                    selectedDevice?.mac === device.mac
                      ? 'bg-brand/10 border-brand'
                      : 'border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-850'
                  }`}
                >
                  <button
                    type='button'
                    onClick={() => handleSelect(device)}
                    className='min-w-0 flex-1 cursor-pointer p-3 text-left'
                  >
                    <div className='font-bold'>{device.hostname}</div>
                    <div className='mt-1 flex justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400'>
                      <span>{device.ip}</span>
                      <span className='font-mono'>{device.mac}</span>
                    </div>
                  </button>
                  <button
                    type='button'
                    title='Identify generator (blinks for 30 seconds)'
                    aria-label={`Identify ${device.hostname}`}
                    disabled={identifyingMac !== null}
                    onClick={() => void handleIdentifyDevice(device)}
                    className={`m-2 flex w-9 shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-wait disabled:opacity-60 ${
                      identifyingMac === device.mac
                        ? 'border-brand bg-brand text-white'
                        : 'border-neutral-300 text-neutral-500 hover:border-brand hover:text-brand dark:border-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <EyeOpenIcon className={identifyingMac === device.mac ? 'animate-pulse' : ''} />
                  </button>
                </div>
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
                    <div className='grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3'>
                      <Label className='whitespace-nowrap text-xs'>IP Address</Label>
                      <InputWithRef
                        value={configIp}
                        onChange={(event) => setConfigIp(event.target.value)}
                        className={`${INPUT_STYLES.default} w-full`}
                        placeholder='192.168.200.182'
                      />
                      <Label className='whitespace-nowrap text-xs'>Subnet Mask</Label>
                      <InputWithRef
                        value={configNetmask}
                        onChange={(event) => setConfigNetmask(event.target.value)}
                        className={`${INPUT_STYLES.default} w-full`}
                        placeholder={DEFAULT_NETMASK}
                      />
                      <Label className='whitespace-nowrap text-xs'>Gateway</Label>
                      <InputWithRef
                        value={configGateway}
                        onChange={(event) => setConfigGateway(event.target.value)}
                        className={`${INPUT_STYLES.default} w-full`}
                        placeholder={DEFAULT_GATEWAY}
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
