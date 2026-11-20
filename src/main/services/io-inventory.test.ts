/** @jest-environment node */
import { type AddressInfo, createServer, type Socket } from 'net'

import { scanIoInventory } from './io-inventory'

async function fixture(mode: 'normal' | 'empty' | 'exception' | 'invalid' | 'disconnect') {
  const requests: Buffer[] = []
  const sockets: Socket[] = []
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('data', (req: Buffer) => {
      requests.push(req)
      if (mode === 'disconnect') {
        socket.destroy()
        return
      }
      const slot = req.readUInt16BE(0)
      const reply = Buffer.alloc(mode === 'exception' ? 9 : 21)
      reply.writeUInt16BE(mode === 'invalid' ? 99 : slot, 0)
      reply.writeUInt16BE(reply.length - 6, 4)
      reply[6] = 1
      reply[7] = mode === 'exception' ? 0x84 : 4
      reply[8] = mode === 'exception' ? 2 : 12
      if (reply.length === 21 && slot === 2 && mode !== 'empty')
        [1, 32, 0, 1, 1, 1].forEach((v, i) => reply.writeUInt16BE(v, 9 + i * 2))
      socket.write(reply.subarray(0, 5) as unknown as Uint8Array)
      setTimeout(() => {
        if (!socket.destroyed) socket.write(reply.subarray(5) as unknown as Uint8Array)
      }, 2)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return { result: await scanIoInventory('127.0.0.1', (server.address() as AddressInfo).port), requests }
  } finally {
    sockets.forEach((s) => s.destroy())
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
}
it('reads seven FC04 blocks with fragmented TCP responses and never writes outputs', async () => {
  const { result, requests } = await fixture('normal')
  expect(result.success).toBe(true)
  if (!result.success) throw new Error(result.error)
  expect(result.inventory.verified).toBe(true)
  expect(result.inventory.modules[1].type).toBe(1)
  expect(requests).toHaveLength(7)
  requests.forEach((req, i) => {
    expect(req[7]).toBe(4)
    expect(req.readUInt16BE(8)).toBe(1094 + i * 100)
    expect(req.readUInt16BE(10)).toBe(6)
  })
})
it('does not treat all-zero legacy registers as a verified empty inventory', async () => {
  const { result } = await fixture('empty')
  expect(result.success && result.inventory.verified).toBe(false)
})
it.each(['exception', 'invalid', 'disconnect'] as const)(
  'rejects %s without returning a partial snapshot',
  async (mode) => {
    const { result } = await fixture(mode)
    expect(result.success).toBe(false)
    if (!result.success) expect(typeof result.error).toBe('string')
  },
)
it('rejects invalid destinations before connecting', async () => {
  expect((await scanIoInventory('http://invalid')).success).toBe(false)
})
