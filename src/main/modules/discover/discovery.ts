import dgram from 'dgram'
import { ipcMain } from 'electron'
import os from 'os'

const DISCOVER_PORT = 30303
const DISCOVER_GUID = '5F90A4A4-D180-4682-B869-A02A6E6D1C75'
const MAC_ADDRESS_PATTERN = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/

interface DeviceInfo {
  ip: string
  hostname: string
  mac: string
  revision: string
  info: string
}

interface ConfigureArgs {
  mac: string
  targetIp: string
  dhcp: boolean
  newIp: string
  netmask: string
  gateway: string
  hostname: string
}

interface NetworkEndpoint {
  address: string
  broadcast: string
  name: string
}

interface BoundSocket {
  socket: dgram.Socket
  endpoint: NetworkEndpoint
}

export class DiscoveryModule {
  constructor() {
    this.registerListeners()
  }

  private registerListeners() {
    ipcMain.handle('device-discover', this.handleDiscover.bind(this))
    ipcMain.handle('device-configure', this.handleConfigure.bind(this))
    ipcMain.handle('device-identify', this.handleIdentify.bind(this))
  }

  private getBroadcastAddress(ip: string, netmask: string): string {
    const ipParts = ip.split('.').map(Number)
    const maskParts = netmask.split('.').map(Number)
    return ipParts.map((part, index) => (part | (~maskParts[index] & 0xff)) >>> 0).join('.')
  }

  private getNetworkEndpoints(): NetworkEndpoint[] {
    const endpoints: NetworkEndpoint[] = [{ address: '0.0.0.0', broadcast: '255.255.255.255', name: 'default' }]

    Object.entries(os.networkInterfaces()).forEach(([name, interfaces]) => {
      interfaces?.forEach((networkInterface) => {
        const isIpv4 = networkInterface.family === 'IPv4' || (networkInterface.family as unknown) === 4
        if (!isIpv4 || networkInterface.internal) return

        endpoints.push({
          address: networkInterface.address,
          broadcast: this.getBroadcastAddress(networkInterface.address, networkInterface.netmask),
          name,
        })
      })
    })

    return endpoints
  }

  private openBroadcastSocket(
    endpoint: NetworkEndpoint,
    onMessage: (message: Buffer, remoteInfo: dgram.RemoteInfo) => void,
  ): Promise<BoundSocket | null> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4')
      let bindingComplete = false

      socket.on('message', onMessage)
      socket.on('error', (error) => {
        console.error(`[Discovery] Socket error on ${endpoint.name} (${endpoint.address}):`, error)
        try {
          socket.close()
        } catch (_error) {
          // Socket may already be closed after a bind or network error.
        }
        if (!bindingComplete) resolve(null)
      })

      socket.bind(0, endpoint.address, () => {
        bindingComplete = true
        socket.setBroadcast(true)
        resolve({ socket, endpoint })
      })
    })
  }

  private async openBroadcastSockets(
    onMessage: (message: Buffer, remoteInfo: dgram.RemoteInfo) => void,
  ): Promise<BoundSocket[]> {
    const sockets = await Promise.all(
      this.getNetworkEndpoints().map((endpoint) => this.openBroadcastSocket(endpoint, onMessage)),
    )
    return sockets.filter((socket): socket is BoundSocket => socket !== null)
  }

  private closeSockets(sockets: BoundSocket[]) {
    sockets.forEach(({ socket }) => {
      try {
        socket.close()
      } catch (_error) {
        // Socket may already be closed after a network error.
      }
    })
  }

  private sendOnAllInterfaces(sockets: BoundSocket[], payload: string, targetIp?: string) {
    sockets.forEach(({ socket, endpoint }) => {
      const destinations = new Set([endpoint.broadcast, '255.255.255.255'])
      if (targetIp) destinations.add(targetIp)

      destinations.forEach((destination) => {
        socket.send(payload, DISCOVER_PORT, destination, (error) => {
          if (error) {
            console.error(`[Discovery] Send error on ${endpoint.name} (${endpoint.address}) to ${destination}:`, error)
          }
        })
      })
    })
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs))
  }

  private async handleDiscover(): Promise<DeviceInfo[]> {
    const devices = new Map<string, DeviceInfo>()
    const onMessage = (message: Buffer, remoteInfo: dgram.RemoteInfo) => {
      try {
        const parts = message.toString().split('\r\n')
        if (parts.length < 4 || parts[0].startsWith('SETIPCONFIG') || parts[0].startsWith('IDENTIFY')) return

        const mac = parts[1].trim().toUpperCase()
        if (!MAC_ADDRESS_PATTERN.test(mac)) return

        devices.set(mac, {
          ip: remoteInfo.address,
          hostname: parts[0].trim(),
          mac,
          revision: parts[2].trim(),
          info: parts[3].trim(),
        })
      } catch (error) {
        console.error('[Discovery] Parse error:', error)
      }
    }

    const sockets = await this.openBroadcastSockets(onMessage)
    if (sockets.length === 0) return []

    this.sendOnAllInterfaces(sockets, DISCOVER_GUID)
    await this.wait(2000)
    this.closeSockets(sockets)
    return Array.from(devices.values())
  }

  private async sendAddressedCommand(
    payload: string,
    targetIp: string | undefined,
    expectedReply: (message: string) => boolean,
    timeoutMs: number,
  ): Promise<boolean> {
    let acknowledged = false
    const onMessage = (message: Buffer) => {
      if (expectedReply(message.toString())) acknowledged = true
    }

    const sockets = await this.openBroadcastSockets(onMessage)
    if (sockets.length === 0) return false

    this.sendOnAllInterfaces(sockets, payload, targetIp)
    const deadline = Date.now() + timeoutMs
    while (!acknowledged && Date.now() < deadline) {
      await this.wait(50)
    }

    this.closeSockets(sockets)
    return acknowledged
  }

  private async handleConfigure(_event: Electron.IpcMainInvokeEvent, args: ConfigureArgs): Promise<boolean> {
    const configString =
      `SETIPCONFIG\r\n${args.mac}\r\n` +
      `DHCP=${args.dhcp ? 'ON' : 'OFF'};IP=${args.newIp};NMASK=${args.netmask};GWADD=${args.gateway};HOSTNAME=${args.hostname};`

    return this.sendAddressedCommand(
      configString,
      args.targetIp,
      (message) => message.startsWith('SETIPCONFIG-ACK'),
      2000,
    )
  }

  private async handleIdentify(_event: Electron.IpcMainInvokeEvent, mac: string): Promise<boolean> {
    const normalizedMac = mac.trim().toUpperCase()
    if (!MAC_ADDRESS_PATTERN.test(normalizedMac)) return false

    const payload = `IDENTIFY\r\n${normalizedMac}\r\n`

    return this.sendAddressedCommand(
      payload,
      undefined,
      (message) => {
        const parts = message.split('\r\n')
        return parts[0] === 'IDENTIFY-ACK' && parts[1]?.trim().toUpperCase() === normalizedMac
      },
      1500,
    )
  }
}
