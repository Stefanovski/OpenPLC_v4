import type { IoRescanResult } from '@root/types/PLC/io-inventory'
import { randomBytes } from 'crypto'
import { isIP, Socket } from 'net'

import { scanIoInventory } from './io-inventory'

const statusErrors: Record<number, string> = {
  3: 'Another hardware scan is running. Wait and try again.',
  4: 'A known slot contains a different module. No cards were added; restore the original module or restart the generator.',
  5: 'An unsupported module or register layout was found. No cards were added.',
  6: 'Hardware changed during the scan. Wait until the cards are ready and scan again.',
  7: 'Generator memory allocation failed. No cards were added.',
  8: 'Scan denied by generator access control. Sign in on the generator with permission to change PLC run mode.',
  9: 'The generator rejected the scan request.',
}

/** Explicit activation only; never invoked by inventory reads, Codex or MCP. */
export async function rescanIoHardware(host: string, port = 502): Promise<IoRescanResult> {
  if (typeof host !== 'string' || !isIP(host)) return { success: false, error: 'Enter a valid generator IP address.' }
  const socket = new Socket()
  let activationRequested = false
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('Connection timeout'))
      }, 2000)
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      socket.connect(port, host, () => {
        clearTimeout(timer)
        resolve()
      })
    })
    let transaction = 0
    const exchange = async (command: number, token: number) => {
      const request = Buffer.alloc(14)
      request.writeUInt16BE(++transaction, 0)
      request.writeUInt16BE(8, 4)
      request[6] = 1
      request[7] = 0x47
      request[8] = 1
      request[9] = command
      request.writeUInt32BE(token, 10)
      const response = await new Promise<Buffer>((resolve, reject) => {
        let data = Buffer.alloc(0)
        const finish = (error?: Error) => {
          clearTimeout(timer)
          socket.off('data', onData)
          socket.off('error', onError)
          socket.off('close', onClose)
          if (error) reject(error)
          else resolve(data)
        }
        const onError = (error: Error) => finish(error)
        const onClose = () => finish(new Error('Connection closed during scan'))
        const onData = (chunk: Buffer) => {
          data = Buffer.concat([data, chunk] as unknown as Uint8Array[])
          if (data.length < 6) return
          const size = data.readUInt16BE(4) + 6
          if (size < 9 || size > 260 || data.length > size) return finish(new Error('Invalid Modbus frame'))
          if (data.length === size) finish()
        }
        const timer = setTimeout(() => finish(new Error('Scan response timeout')), 2000)
        socket.on('data', onData)
        socket.once('error', onError)
        socket.once('close', onClose)
        socket.write(request as unknown as Uint8Array)
      })
      if (response.readUInt16BE(0) !== transaction || response.readUInt16BE(2) !== 0 || response[6] !== 1)
        throw new Error('Unexpected Modbus response')
      if (response[7] === 0xc7)
        throw new Error('Manual scan is unavailable. Install M7 firmware with IO rescan support.')
      if (
        response.length !== 17 ||
        response[7] !== 0x47 ||
        response[8] !== 1 ||
        response[9] !== command ||
        response[10] > 9 ||
        response[11] > 127 ||
        response[12] > 127 ||
        (response[11] & ~response[12]) !== 0
      )
        throw new Error('Invalid IO scan response')
      return { status: response[10], added: response[11], late: response[12], token: response.readUInt32BE(13) }
    }
    // Version/capability probe is read-only. Old firmware never receives START.
    const probe = await exchange(0, 0)
    if (probe.status === 1) throw new Error(statusErrors[3])
    let token: number
    do {
      token = randomBytes(4).readUInt32BE(0)
    } while (token === 0 || token === probe.token)
    activationRequested = true
    let reply = await exchange(1, token)
    if (statusErrors[reply.status]) {
      activationRequested = false
      throw new Error(statusErrors[reply.status])
    }
    const deadline = Date.now() + 5000
    while (true) {
      if (reply.token !== token) throw new Error('Scan result belongs to another request; read hardware again.')
      if (statusErrors[reply.status]) {
        activationRequested = false // Firmware explicitly rejected the operation.
        throw new Error(statusErrors[reply.status])
      }
      if (reply.status === 2) break
      if (reply.status !== 1) throw new Error('Unexpected scan state')
      if (Date.now() >= deadline) throw new Error('Hardware scan timeout')
      await new Promise((resolve) => setTimeout(resolve, 100))
      reply = await exchange(0, token)
    }
    socket.destroy()
    const inventory = await scanIoInventory(host, port)
    if (!inventory.success) throw new Error(`Scan completed, but inventory read failed: ${inventory.error}`)
    if (
      inventory.inventory.modules.some(
        (module) => reply.added & (1 << (module.slot - 1)) && (!module.type || !module.communicationOk),
      )
    )
      throw new Error('Scan completed, but a newly activated slot could not be verified in the inventory')
    const slots = (mask: number) =>
      Array.from({ length: 7 }, (_, i) => i + 1).filter((slot) => mask & (1 << (slot - 1)))
    return {
      ...inventory,
      inventory: { ...inventory.inventory, verified: true },
      addedSlots: slots(reply.added),
      plcOnlySlots: slots(reply.late),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error:
        message + (activationRequested ? ' Activation may already have completed. Read hardware before retrying.' : ''),
    }
  } finally {
    socket.destroy()
  }
}
