import os from 'os'
import dgram from 'dgram'
import { ipcMain } from 'electron'

const DISCOVER_PORT = 30303
const DISCOVER_GUID = '5F90A4A4-D180-4682-B869-A02A6E6D1C75'

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

export class DiscoveryModule {
  constructor() {
    this.registerListeners()
  }

  /**
   * Registriert die IPC Handler, damit das Frontend sie aufrufen kann.
   */
  private registerListeners() {
    ipcMain.handle('device-discover', this.handleDiscover.bind(this))
    ipcMain.handle('device-configure', this.handleConfigure.bind(this))
  }

  // Hilfsfunktion: Berechnet die Broadcast-Adresse aus IP und Subnetzmaske
  private getBroadcastAddress(ip: string, netmask: string): string {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);

    // Broadcast = IP | (~SubnetMask)
    // Wir machen das Byte für Byte
    const broadcastParts = ipParts.map((part, i) => {
      return (part | (~maskParts[i] & 0xFF)) >>> 0;
    });

    return broadcastParts.join('.');
  }

  /**
   * Sucht nach Geräten im Netzwerk via UDP Broadcast
   */
  private async handleDiscover(): Promise<DeviceInfo[]> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4')
      const devices: DeviceInfo[] = []
      const discoveredIps = new Set<string>()

      // Fehlerbehandlung für den Socket
      socket.on('error', (err) => {
        console.error('[Discovery] Socket error:', err)
        try { socket.close() } catch (e) {}
      })

      // Socket binden (Port 0 = zufälliger freier Port)
      socket.bind(() => {
        socket.setBroadcast(true)
        const message = Buffer.from(DISCOVER_GUID)

        try {
          // 1. Liste alle Netzwerk-Interfaces ab
          const interfaces = os.networkInterfaces();

          // 2. Iteriere über alle Interfaces
          Object.keys(interfaces).forEach((ifaceName) => {
            interfaces[ifaceName]?.forEach((iface) => {
              // Nur IPv4 und keine Loopback-Adapter (127.0.0.1)
              if (iface.family === 'IPv4' && !iface.internal) {
                
                // Berechne die spezifische Broadcast-Adresse für dieses Subnetz
                // z.B. IP 192.168.1.50 / Mask 255.255.255.0 -> Broadcast 192.168.1.255
                const broadcastAddr = this.getBroadcastAddress(iface.address, iface.netmask);
                
                console.log(`[Discovery] Sending to ${ifaceName} (${iface.address}) -> ${broadcastAddr}`);
                
                socket.send(message as any, 0, message.length, DISCOVER_PORT, broadcastAddr, (err) => {
                  if (err) console.error(`[Discovery] Error sending to ${broadcastAddr}:`, err);
                });
              }
            });
          });

          // Optional: Trotzdem noch einmal an global Broadcast senden (für Router, die das mögen)
          socket.send(message as any, 0, message.length, DISCOVER_PORT, '255.255.255.255');

        } catch (e) {
          console.error('[Discovery] Send error:', e)
        }
      })
      // Antworten empfangen
      socket.on('message', (msg, rinfo) => {
        try {
          const text = msg.toString()
          // Format analog zu deinem Python-Script: hostname\r\nmac\r\nrevision\r\ninfo
          const parts = text.split('\r\n')

          if (parts.length >= 4 && !discoveredIps.has(rinfo.address)) {
            discoveredIps.add(rinfo.address)
            devices.push({
              ip: rinfo.address,
              hostname: parts[0].trim(),
              mac: parts[1].trim(),
              revision: parts[2].trim(),
              info: parts[3].trim(),
            })
          }
        } catch (e) {
          console.error('[Discovery] Parse error:', e)
        }
      })

      // Nach 2 Sekunden Timeout beenden wir die Suche
      setTimeout(() => {
        try { socket.close() } catch (e) {}
        resolve(devices)
      }, 2000)
    })
  }

  /**
   * Sendet die Konfiguration an ein spezifisches Gerät
   */
  private async handleConfigure(_event: Electron.IpcMainInvokeEvent, args: ConfigureArgs): Promise<boolean> {
    const socket = dgram.createSocket('udp4')
    
    // Protokoll exakt wie im Python Script
    const configString =
      `SETIPCONFIG\r\n${args.mac}\r\n` +
      `DHCP=${args.dhcp ? 'ON' : 'OFF'};IP=${args.newIp};NMASK=${args.netmask};GWADD=${args.gateway};HOSTNAME=${args.hostname};`
    
    const payload = Buffer.from(configString)

    return new Promise((resolve) => {
      socket.bind(() => {
        socket.setBroadcast(true)
        try {
          // 1. Broadcast senden (um sicherzugehen)
          socket.send(payload as any, 0, payload.length, DISCOVER_PORT, '255.255.255.255')
          // 2. Unicast an die alte IP senden (falls Broadcasts gefiltert werden)
          socket.send(payload as any, 0, payload.length, DISCOVER_PORT, args.targetIp)
        } catch (e) {
          console.error('[Discovery] Config send error:', e)
        }
      })

      // Wir warten hier nicht auf das ACK (um es einfach zu halten),
      // sondern schließen nach 1 Sekunde und melden Erfolg.
      setTimeout(() => {
        try { socket.close() } catch (e) {}
        resolve(true)
      }, 1000)
    })
  }
}