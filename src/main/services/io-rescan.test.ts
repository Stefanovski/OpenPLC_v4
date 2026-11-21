/** @jest-environment node */
import { type AddressInfo, createServer, type Socket } from 'net'

import { rescanIoHardware } from './io-rescan'

type Mode =
  | 'success'
  | 'legacy'
  | 'busy'
  | 'denied'
  | 'changed'
  | 'unknown'
  | 'unstable'
  | 'memory'
  | 'wrong-token'
  | 'disconnect'
  | 'bad-frame'
  | 'read-failed'
  | 'empty'
async function fixture(mode: Mode) {
  const requests: Buffer[] = []
  const sockets: Socket[] = []
  let token = 0
  let polls = 0
  const server = createServer((socket) => {
    sockets.push(socket)
    let pending = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk] as unknown as Uint8Array[])
      while (pending.length >= 6 && pending.length >= pending.readUInt16BE(4) + 6) {
        const req = pending.subarray(0, pending.readUInt16BE(4) + 6)
        pending = pending.subarray(req.length)
        requests.push(req)
        const inventory = req[7] === 4
        const exception = mode === 'legacy' || (inventory && mode === 'read-failed')
        const reply = Buffer.alloc(exception ? 9 : inventory ? 21 : 17)
        reply.writeUInt16BE(req.readUInt16BE(0), 0)
        reply.writeUInt16BE(reply.length - 6, 4)
        reply[6] = 1
        reply[7] = req[7] | (exception ? 0x80 : 0)
        reply[8] = inventory && !exception ? 12 : 1
        if (!exception && !inventory) {
          reply[9] = req[9]
          if (req[9] === 1) token = req.readUInt32BE(10)
          if (mode === 'disconnect' && token) {
            socket.destroy()
            return
          }
          reply[10] = token ? (polls++ === 0 ? 1 : 2) : mode === 'busy' ? 1 : 0
          if (token && ['denied', 'changed', 'unknown', 'unstable', 'memory'].includes(mode))
            reply[10] = { denied: 8, changed: 4, unknown: 5, unstable: 6, memory: 7 }[mode as 'denied']
          reply[11] = reply[10] === 2 && mode !== 'empty' ? 2 : 0
          reply[12] = reply[11]
          reply.writeUInt32BE(mode === 'wrong-token' && token ? (token ^ 1) >>> 0 : token, 13)
          if (mode === 'bad-frame') reply[8] = 99
        }
        if (inventory && !exception && mode !== 'empty' && req.readUInt16BE(8) === 1194)
          [1, 32, 0, 1, 1, 1].forEach((value, i) => reply.writeUInt16BE(value, 9 + i * 2))
        socket.write(reply.subarray(0, 5) as unknown as Uint8Array)
        setTimeout(() => {
          if (!socket.destroyed) socket.write(reply.subarray(5) as unknown as Uint8Array)
        }, 2)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return { result: await rescanIoHardware('127.0.0.1', (server.address() as AddressInfo).port), requests }
  } finally {
    sockets.forEach((socket) => socket.destroy())
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

it('probes, activates exactly once, waits for completion and reads all seven slots', async () => {
  const { result, requests } = await fixture('success')
  expect(result.success).toBe(true)
  if (!result.success) throw new Error(result.error)
  expect(result.addedSlots).toEqual([2])
  expect(result.plcOnlySlots).toEqual([2])
  expect(result.inventory.modules[1].type).toBe(1)
  expect(requests[0][9]).toBe(0)
  expect(requests.filter((r) => r[7] === 0x47 && r[9] === 1)).toHaveLength(1)
  expect(requests.filter((r) => r[7] === 4)).toHaveLength(7)
  expect(requests.every((r) => r[7] === 4 || r[7] === 0x47)).toBe(true)
})
it.each(['legacy', 'busy', 'bad-frame'] as const)('never sends activation after a failed %s probe', async (mode) => {
  const { result, requests } = await fixture(mode)
  expect(result.success).toBe(false)
  expect(requests).toHaveLength(1)
  expect(requests[0][9]).toBe(0)
})
it.each(['denied', 'changed', 'unknown', 'unstable', 'memory'] as const)(
  'reports firmware rejection: %s',
  async (mode) => {
    const { result, requests } = await fixture(mode)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).not.toContain('may already')
    expect(requests).toHaveLength(2)
  },
)
it.each(['wrong-token', 'disconnect', 'read-failed'] as const)(
  'reports uncertain activation without retrying after %s',
  async (mode) => {
    const { result, requests } = await fixture(mode)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('may already')
    expect(requests.filter((r) => r[7] === 0x47 && r[9] === 1)).toHaveLength(1)
  },
)
it('handles a successful scan without new cards', async () => {
  const { result } = await fixture('empty')
  expect(result.success && result.addedSlots).toEqual([])
  expect(result.success && result.inventory.verified).toBe(true)
})
it('rejects invalid destinations', async () => {
  expect((await rescanIoHardware('invalid')).success).toBe(false)
})
