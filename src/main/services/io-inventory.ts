import { decodeIoModule, type IoScanResult } from '@root/types/PLC/io-inventory'
import { isIP,Socket } from 'net'

/** Separate, read-only FC04 connection. Does not touch the debugger session. */
export async function scanIoInventory(host: string, port = 502): Promise<IoScanResult> {
  if (typeof host !== 'string' || !isIP(host)) return { success: false, error: 'Enter a valid generator IP address.' }
  const socket = new Socket()
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
    const modules = []
    for (let slot = 1; slot <= 7; slot++) {
      const request = Buffer.alloc(12)
      request.writeUInt16BE(slot, 0)
      request.writeUInt16BE(6, 4)
      request[6] = 1
      request[7] = 4
      request.writeUInt16BE(1094 + (slot - 1) * 100, 8)
      request.writeUInt16BE(6, 10)
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
        const onClose = () => finish(new Error('Connection closed during inventory read'))
        const onData = (chunk: Buffer) => {
          data = Buffer.concat([data, chunk] as unknown as Uint8Array[])
          if (data.length < 6) return
          const size = data.readUInt16BE(4) + 6
          if (size < 9 || size > 260 || data.length > size) {
            finish(new Error('Invalid Modbus frame'))
            return
          }
          if (data.length === size) finish()
        }
        const timer = setTimeout(() => finish(new Error('Inventory read timeout')), 2000)
        socket.on('data', onData)
        socket.once('error', onError)
        socket.once('close', onClose)
        socket.write(request as unknown as Uint8Array)
      })
      if (response.readUInt16BE(0) !== slot || response.readUInt16BE(2) !== 0 || response[6] !== 1)
        throw new Error('Unexpected Modbus response')
      if (response[7] === 0x84)
        throw new Error(`Inventory unavailable (Modbus exception ${response[8]}). Check generator firmware.`)
      if (response[7] !== 4 || response.length !== 21 || response[8] !== 12)
        throw new Error('Invalid inventory response')
      modules.push(
        decodeIoModule(
          slot,
          Array.from({ length: 6 }, (_, i) => response.readUInt16BE(9 + i * 2)),
        ),
      )
    }
    return {
      success: true,
      inventory: { host, readAt: Date.now(), modules, verified: modules.some((m) => m.version === 1) },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    socket.destroy()
  }
}
