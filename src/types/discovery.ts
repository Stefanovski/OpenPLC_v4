// src/renderer/types/discovery.ts

export interface DeviceInfo {
  ip: string
  hostname: string
  mac: string
  revision: string
  info: string
}

export interface DeviceConfig {
  mac: string
  targetIp: string
  dhcp: boolean
  newIp: string
  netmask: string
  gateway: string
  hostname: string
}