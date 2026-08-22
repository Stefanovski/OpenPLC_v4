import { AddressInfo, createServer, Server, Socket } from 'node:net'

import { IecDebugCommand, IecDebugResult, IecDebugState, ModbusFunctionCode, ModbusTcpClient } from './modbus-client'

type CapturedRequest = { command: IecDebugCommand; payload: Buffer }

describe('ModbusTcpClient IEC debugger protocol', () => {
  let server: Server
  let client: ModbusTcpClient
  const requests: CapturedRequest[] = []

  const respond = (socket: Socket, request: Buffer) => {
    const command = request.readUInt8(9) as IecDebugCommand
    const requestPayload = request.subarray(10)
    requests.push({ command, payload: Buffer.from(requestPayload) })

    let result = IecDebugResult.OK
    let payload = Buffer.alloc(0)
    if (command === IecDebugCommand.CAPABILITIES) {
      payload = Buffer.alloc(4)
      payload.writeUInt32BE(0x1f)
    } else if (command === IecDebugCommand.STATUS) {
      payload = Buffer.alloc(33)
      payload.writeUInt8(IecDebugState.HALTED, 0)
      payload.writeUInt32BE(0x12345678, 1)
      payload.writeUInt32BE(0x23456789, 5)
      payload.writeUInt32BE(0, 9)
      payload.writeUInt16BE(2, 13)
      payload.writeUInt16BE(64, 15)
      payload.writeBigUInt64BE(123n, 17)
      payload.writeBigUInt64BE(4n, 25)
    } else if (command === IecDebugCommand.READ_VARIABLE) {
      if (requestPayload.readUInt32BE(0) === 0xdead) result = IecDebugResult.NOT_FOUND
      else {
        payload = Buffer.alloc(9)
        payload.writeUInt8(1, 0)
        payload.writeUInt16BE(6, 1)
        payload.writeUInt16BE(4, 3)
        payload.writeInt32LE(42, 5)
      }
    } else if (command === IecDebugCommand.READ_VARIABLES) {
      const count = requestPayload.readUInt8(0)
      const values = Array.from({ length: count }, (_, index) => {
        const requestOffset = 1 + index * 6
        const id = requestPayload.readUInt32BE(requestOffset)
        const type = requestPayload.readUInt16BE(requestOffset + 4)
        const value = type === 1 ? Buffer.from([1]) : Buffer.from([42, 0, 0, 0])
        const entry = Buffer.alloc(9 + value.length)
        entry.writeUInt32BE(id, 0)
        entry.writeUInt8(index === 0 ? 1 : 0, 4)
        entry.writeUInt16BE(type, 5)
        entry.writeUInt16BE(value.length, 7)
        for (let valueIndex = 0; valueIndex < value.length; valueIndex++) entry[9 + valueIndex] = value[valueIndex]
        return entry
      })
      payload = Buffer.alloc(1 + values.reduce((size, value) => size + value.length, 0))
      payload.writeUInt8(count, 0)
      let payloadOffset = 1
      for (const value of values) {
        for (let index = 0; index < value.length; index++) payload[payloadOffset + index] = value[index]
        payloadOffset += value.length
      }
    }

    const response = Buffer.alloc(11 + payload.length)
    response.writeUInt16BE(request.readUInt16BE(0), 0)
    response.writeUInt16BE(0, 2)
    response.writeUInt16BE(response.length - 6, 4)
    response.writeUInt8(0, 6)
    response.writeUInt8(ModbusFunctionCode.IEC_DEBUG, 7)
    response.writeUInt8(1, 8)
    response.writeUInt8(command, 9)
    response.writeUInt8(result, 10)
    for (let index = 0; index < payload.length; index++) response[11 + index] = payload[index]
    socket.write(response as unknown as Uint8Array)
  }

  beforeAll(async () => {
    server = createServer((socket) => socket.on('data', (request: Buffer) => respond(socket, request)))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    client = new ModbusTcpClient({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      timeout: 1000,
    })
    await client.connect()
  })

  afterAll(async () => {
    client.disconnect()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  beforeEach(() => requests.splice(0))

  it('reads capabilities and the halted statement status', async () => {
    await expect(client.getIecDebugCapabilities()).resolves.toBe(0x1f)
    await expect(client.getIecDebugStatus()).resolves.toEqual({
      state: IecDebugState.HALTED,
      currentStatementId: 0x12345678,
      currentPouId: 0x23456789,
      currentInstanceId: 0,
      breakpointCount: 2,
      breakpointCapacity: 64,
      pointCount: 123n,
      haltCount: 4n,
    })
  })

  it('encodes breakpoint, continue and step commands', async () => {
    await client.setIecDebugBreakpoint(0x10203040)
    await client.clearIecDebugBreakpoint(0x10203040)
    await client.continueIecDebug()
    await client.stepIntoIecDebug()

    expect(requests.map((request) => request.command)).toEqual([
      IecDebugCommand.SET_BREAKPOINT,
      IecDebugCommand.CLEAR_BREAKPOINT,
      IecDebugCommand.CONTINUE,
      IecDebugCommand.STEP_INTO,
    ])
    expect(requests[0].payload.readUInt32BE(0)).toBe(0x10203040)
  })

  it('reads and modifies a typed stable-ID variable', async () => {
    await expect(client.readIecDebugVariable(0x1020, 6)).resolves.toEqual({
      forced: true,
      type: 6,
      value: Buffer.from([42, 0, 0, 0]),
    })
    await client.writeIecDebugVariable(0x1020, 6, Buffer.from([1, 0, 0, 0]))
    await client.forceIecDebugVariable(0x1020, 6, Buffer.from([2, 0, 0, 0]))
    await client.unforceIecDebugVariable(0x1020)

    expect(requests.map((request) => request.command)).toEqual([
      IecDebugCommand.READ_VARIABLE,
      IecDebugCommand.WRITE_VARIABLE,
      IecDebugCommand.FORCE_VARIABLE,
      IecDebugCommand.UNFORCE_VARIABLE,
    ])
    expect(requests[2].payload.readUInt16BE(6)).toBe(4)
  })

  it('reads a bounded stable-ID watch list in one request', async () => {
    await expect(
      client.readIecDebugVariables([
        { id: 0x1001, type: 1 },
        { id: 0x1002, type: 6 },
      ]),
    ).resolves.toEqual([
      { id: 0x1001, forced: true, type: 1, value: Buffer.from([1]) },
      { id: 0x1002, forced: false, type: 6, value: Buffer.from([42, 0, 0, 0]) },
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0].command).toBe(IecDebugCommand.READ_VARIABLES)
    expect(requests[0].payload.readUInt8(0)).toBe(2)
  })

  it('rejects an empty or oversized watch batch before sending it', async () => {
    await expect(client.readIecDebugVariables([])).rejects.toThrow('between 1 and 24')
    await expect(
      client.readIecDebugVariables(Array.from({ length: 25 }, (_, index) => ({ id: index + 1, type: 1 }))),
    ).rejects.toThrow('between 1 and 24')
    expect(requests).toHaveLength(0)
  })

  it('reports target-side result codes', async () => {
    await expect(client.readIecDebugVariable(0xdead, 6)).rejects.toThrow('NOT_FOUND')
  })
})
