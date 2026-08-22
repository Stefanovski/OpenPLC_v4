import { Socket } from 'net'

export enum ModbusFunctionCode {
  DEBUG_INFO = 0x41,
  DEBUG_SET = 0x42,
  DEBUG_GET = 0x43,
  DEBUG_GET_LIST = 0x44,
  DEBUG_GET_MD5 = 0x45,
  IEC_DEBUG = 0x46,
}

export enum IecDebugCommand {
  CAPABILITIES = 0,
  STATUS = 1,
  SET_BREAKPOINT = 2,
  CLEAR_BREAKPOINT = 3,
  CLEAR_BREAKPOINTS = 4,
  CONTINUE = 5,
  STEP_INTO = 6,
  STEP_OVER = 7,
  STEP_OUT = 8,
  READ_VARIABLE = 9,
  WRITE_VARIABLE = 10,
  FORCE_VARIABLE = 11,
  UNFORCE_VARIABLE = 12,
  READ_VARIABLES = 13,
}

export enum IecDebugResult {
  OK = 0,
  INVALID_ARGUMENT = 1,
  NOT_FOUND = 2,
  TABLE_FULL = 3,
  INVALID_STATE = 4,
  TYPE_MISMATCH = 5,
  SIZE_MISMATCH = 6,
  READ_ONLY = 7,
  FORCED = 8,
  UNSUPPORTED = 9,
  BUSY = 10,
  PROTOCOL_ERROR = 11,
}

export enum IecDebugState {
  RUN = 0,
  HALTED = 1,
  STEP_INTO = 2,
  STEP_OVER = 3,
  STEP_OUT = 4,
}

export type IecDebugStatus = {
  state: IecDebugState
  currentStatementId: number
  currentPouId: number
  currentInstanceId: number
  breakpointCount: number
  breakpointCapacity: number
  pointCount: bigint
  haltCount: bigint
}

export type IecDebugVariableValue = {
  forced: boolean
  type: number
  value: Buffer
}

export type IecDebugVariableRequest = {
  id: number
  type: number
}

export type IecDebugVariableBatchValue = IecDebugVariableValue & {
  id: number
}

export enum ModbusDebugResponse {
  SUCCESS = 0x7e,
  ERROR_OUT_OF_BOUNDS = 0x81,
  ERROR_OUT_OF_MEMORY = 0x82,
}

interface ModbusTcpClientOptions {
  host: string
  port: number
  timeout: number
}

export class ModbusTcpClient {
  private static readonly IEC_DEBUG_PROTOCOL_VERSION = 1
  private host: string
  private port: number
  private timeout: number
  private socket: Socket | null = null
  private transactionId: number = 0
  private sendRequestMutex: Promise<void> = Promise.resolve()

  constructor(options: ModbusTcpClientOptions) {
    this.host = options.host
    this.port = options.port
    this.timeout = options.timeout
  }

  private incrementTransactionId(): number {
    this.transactionId = (this.transactionId + 1) % 65536
    return this.transactionId
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket()

      const timeoutHandle = setTimeout(() => {
        this.socket?.destroy()
        reject(new Error('Connection timeout'))
      }, this.timeout)

      this.socket.connect(this.port, this.host, () => {
        clearTimeout(timeoutHandle)
        resolve()
      })

      this.socket.on('error', (error) => {
        clearTimeout(timeoutHandle)
        reject(error)
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  private sendTcpRequestImpl(request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Not connected to target'))
        return
      }

      const timeoutHandle = setTimeout(() => {
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        reject(new Error('Request timeout'))
      }, this.timeout)

      const onData = (data: Buffer) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        resolve(data)
      }

      const onError = (error: Error) => {
        clearTimeout(timeoutHandle)
        this.socket?.removeListener('data', onData)
        this.socket?.removeListener('error', onError)
        reject(error)
      }

      this.socket.once('data', onData)
      this.socket.once('error', onError)
      this.socket.write(request as unknown as Uint8Array)
    })
  }

  private sendTcpRequest(request: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      this.sendRequestMutex = this.sendRequestMutex.then(
        () => this.sendTcpRequestImpl(request).then(resolve, reject),
        () => this.sendTcpRequestImpl(request).then(resolve, reject),
      )
    })
  }

  private async sendIecDebugCommand(command: IecDebugCommand, payload = Buffer.alloc(0)): Promise<Buffer> {
    if (!this.socket) throw new Error('Not connected to target')
    const transactionId = this.incrementTransactionId()
    const request = Buffer.alloc(10 + payload.length)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(0, 2)
    request.writeUInt16BE(request.length - 6, 4)
    request.writeUInt8(0, 6)
    request.writeUInt8(ModbusFunctionCode.IEC_DEBUG, 7)
    request.writeUInt8(ModbusTcpClient.IEC_DEBUG_PROTOCOL_VERSION, 8)
    request.writeUInt8(command, 9)
    for (let index = 0; index < payload.length; index++) request[10 + index] = payload[index]

    const response = await this.sendTcpRequest(request)
    if (response.length < 11) throw new Error(`Invalid IEC debug response length ${response.length}`)
    if (response.readUInt16BE(0) !== transactionId) throw new Error('IEC debug transaction ID mismatch')
    if ((response.readUInt8(7) as ModbusFunctionCode) !== ModbusFunctionCode.IEC_DEBUG) {
      throw new Error('IEC debug function code mismatch')
    }
    if (response.readUInt8(8) !== ModbusTcpClient.IEC_DEBUG_PROTOCOL_VERSION) {
      throw new Error(`Unsupported IEC debug protocol version ${response.readUInt8(8)}`)
    }
    if ((response.readUInt8(9) as IecDebugCommand) !== command) throw new Error('IEC debug command mismatch')
    const result = response.readUInt8(10) as IecDebugResult
    if (result !== IecDebugResult.OK) throw new Error(`IEC debug command ${command} failed: ${IecDebugResult[result]}`)
    return response.subarray(11)
  }

  async getIecDebugCapabilities(): Promise<number> {
    const payload = await this.sendIecDebugCommand(IecDebugCommand.CAPABILITIES)
    if (payload.length !== 4) throw new Error('Invalid IEC debug capabilities response')
    return payload.readUInt32BE(0)
  }

  async getIecDebugStatus(): Promise<IecDebugStatus> {
    const payload = await this.sendIecDebugCommand(IecDebugCommand.STATUS)
    if (payload.length !== 33) throw new Error('Invalid IEC debug status response')
    return {
      state: payload.readUInt8(0) as IecDebugState,
      currentStatementId: payload.readUInt32BE(1),
      currentPouId: payload.readUInt32BE(5),
      currentInstanceId: payload.readUInt32BE(9),
      breakpointCount: payload.readUInt16BE(13),
      breakpointCapacity: payload.readUInt16BE(15),
      pointCount: payload.readBigUInt64BE(17),
      haltCount: payload.readBigUInt64BE(25),
    }
  }

  async setIecDebugBreakpoint(statementId: number): Promise<void> {
    const payload = Buffer.alloc(4)
    payload.writeUInt32BE(statementId, 0)
    await this.sendIecDebugCommand(IecDebugCommand.SET_BREAKPOINT, payload)
  }

  async clearIecDebugBreakpoint(statementId: number): Promise<void> {
    const payload = Buffer.alloc(4)
    payload.writeUInt32BE(statementId, 0)
    await this.sendIecDebugCommand(IecDebugCommand.CLEAR_BREAKPOINT, payload)
  }

  async clearIecDebugBreakpoints(): Promise<void> {
    await this.sendIecDebugCommand(IecDebugCommand.CLEAR_BREAKPOINTS)
  }

  async continueIecDebug(): Promise<void> {
    await this.sendIecDebugCommand(IecDebugCommand.CONTINUE)
  }

  async stepIntoIecDebug(): Promise<void> {
    await this.sendIecDebugCommand(IecDebugCommand.STEP_INTO)
  }

  async readIecDebugVariable(id: number, type: number): Promise<IecDebugVariableValue> {
    const request = Buffer.alloc(6)
    request.writeUInt32BE(id, 0)
    request.writeUInt16BE(type, 4)
    const payload = await this.sendIecDebugCommand(IecDebugCommand.READ_VARIABLE, request)
    if (payload.length < 5) throw new Error('Invalid IEC debug variable response')
    const size = payload.readUInt16BE(3)
    if (payload.length !== size + 5) throw new Error('Incomplete IEC debug variable value')
    return { forced: payload.readUInt8(0) !== 0, type: payload.readUInt16BE(1), value: payload.subarray(5) }
  }

  async readIecDebugVariables(variables: IecDebugVariableRequest[]): Promise<IecDebugVariableBatchValue[]> {
    if (variables.length === 0 || variables.length > 24)
      throw new Error('IEC debug batch size must be between 1 and 24')
    const request = Buffer.alloc(1 + variables.length * 6)
    request.writeUInt8(variables.length, 0)
    variables.forEach((variable, index) => {
      const offset = 1 + index * 6
      request.writeUInt32BE(variable.id, offset)
      request.writeUInt16BE(variable.type, offset + 4)
    })

    const payload = await this.sendIecDebugCommand(IecDebugCommand.READ_VARIABLES, request)
    if (payload.length < 1 || payload.readUInt8(0) !== variables.length) {
      throw new Error('Invalid IEC debug batch response count')
    }

    const values: IecDebugVariableBatchValue[] = []
    let offset = 1
    for (let index = 0; index < variables.length; index++) {
      if (offset + 9 > payload.length) throw new Error('Incomplete IEC debug batch descriptor')
      const size = payload.readUInt16BE(offset + 7)
      if (offset + 9 + size > payload.length) throw new Error('Incomplete IEC debug batch value')
      values.push({
        id: payload.readUInt32BE(offset),
        forced: payload.readUInt8(offset + 4) !== 0,
        type: payload.readUInt16BE(offset + 5),
        value: payload.subarray(offset + 9, offset + 9 + size),
      })
      offset += 9 + size
    }
    if (offset !== payload.length) throw new Error('Unexpected trailing IEC debug batch data')
    return values
  }

  private async modifyIecDebugVariable(command: IecDebugCommand, id: number, type: number, value: Buffer) {
    const payload = Buffer.alloc(8 + value.length)
    payload.writeUInt32BE(id, 0)
    payload.writeUInt16BE(type, 4)
    payload.writeUInt16BE(value.length, 6)
    for (let index = 0; index < value.length; index++) payload[8 + index] = value[index]
    await this.sendIecDebugCommand(command, payload)
  }

  async writeIecDebugVariable(id: number, type: number, value: Buffer): Promise<void> {
    await this.modifyIecDebugVariable(IecDebugCommand.WRITE_VARIABLE, id, type, value)
  }

  async forceIecDebugVariable(id: number, type: number, value: Buffer): Promise<void> {
    await this.modifyIecDebugVariable(IecDebugCommand.FORCE_VARIABLE, id, type, value)
  }

  async unforceIecDebugVariable(id: number): Promise<void> {
    const payload = Buffer.alloc(4)
    payload.writeUInt32BE(id, 0)
    await this.sendIecDebugCommand(IecDebugCommand.UNFORCE_VARIABLE, payload)
  }

  async getMd5Hash(): Promise<string> {
    if (!this.socket) {
      throw new Error('Not connected to target')
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_GET_MD5
    const endiannessCheck = 0xdead

    const request = Buffer.alloc(12)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(6, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(endiannessCheck, 8)
    request.writeUInt8(0, 10)
    request.writeUInt8(0, 11)

    const data = await this.sendTcpRequest(request)

    if (data.length < 9) {
      throw new Error('Invalid response: too short')
    }

    const responseTransactionId = data.readUInt16BE(0)
    const responseFunctionCode = data.readUInt8(7)
    const statusCode = data.readUInt8(8)

    if (responseTransactionId !== transactionId) {
      throw new Error('Transaction ID mismatch')
    }

    if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_MD5 as number)) {
      throw new Error('Function code mismatch')
    }

    if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
      throw new Error(`Target returned error code: 0x${statusCode.toString(16)}`)
    }

    const md5String = data.slice(9).toString('utf-8').trim()
    return md5String
  }

  async getVariablesList(variableIndexes: number[]): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: Buffer
    error?: string
  }> {
    if (!this.socket) {
      return { success: false, error: 'Not connected to target' }
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_GET_LIST
    const numIndexes = variableIndexes.length

    const pduLength = 4 + 2 * numIndexes
    const request = Buffer.alloc(6 + pduLength)

    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(pduLength, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(numIndexes, 8)

    for (let i = 0; i < numIndexes; i++) {
      request.writeUInt16BE(variableIndexes[i], 10 + i * 2)
    }

    try {
      const data = await this.sendTcpRequest(request)

      if (data.length < 9) {
        return { success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` }
      }

      const responseTransactionId = data.readUInt16BE(0)
      const responseFunctionCode = data.readUInt8(7)
      const statusCode = data.readUInt8(8)

      if (responseTransactionId !== transactionId) {
        return { success: false, error: 'Transaction ID mismatch' }
      }

      if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_GET_LIST as number)) {
        return { success: false, error: 'Function code mismatch' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
        return { success: false, error: 'ERROR_OUT_OF_BOUNDS' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
        return { success: false, error: 'ERROR_OUT_OF_MEMORY' }
      }

      if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
        return { success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` }
      }

      if (data.length < 17) {
        return {
          success: false,
          error: `Incomplete success response (${data.length} bytes, expected at least 17)`,
        }
      }

      const lastIndex = data.readUInt16BE(9)
      const tick = data.readUInt32BE(11)
      const responseSize = data.readUInt16BE(15)

      if (data.length < 17 + responseSize) {
        return {
          success: false,
          error: `Incomplete variable data (expected ${responseSize} bytes, got ${data.length - 17})`,
        }
      }

      const variableData = data.slice(17, 17 + responseSize)

      return {
        success: true,
        tick,
        lastIndex,
        data: variableData,
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async setVariable(
    variableIndex: number,
    force: boolean,
    valueBuffer?: Buffer,
  ): Promise<{
    success: boolean
    error?: string
  }> {
    if (!this.socket) {
      return { success: false, error: 'Not connected to target' }
    }

    const transactionId = this.incrementTransactionId()
    const protocolId = 0x0000
    const unitId = 0x00
    const functionCode = ModbusFunctionCode.DEBUG_SET

    const dataLength = force && valueBuffer ? valueBuffer.length : 1
    const pduLength = 7 + dataLength
    const request = Buffer.alloc(6 + pduLength)

    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(protocolId, 2)
    request.writeUInt16BE(pduLength, 4)
    request.writeUInt8(unitId, 6)
    request.writeUInt8(functionCode, 7)
    request.writeUInt16BE(variableIndex, 8)
    request.writeUInt8(force ? 1 : 0, 10)
    request.writeUInt16BE(dataLength, 11)

    if (force && valueBuffer) {
      for (let i = 0; i < valueBuffer.length; i++) {
        request.writeUInt8(valueBuffer[i], 13 + i)
      }
    } else {
      request.writeUInt8(0, 13)
    }

    try {
      const data = await this.sendTcpRequest(request)

      if (data.length < 9) {
        return { success: false, error: `Invalid response: too short (${data.length} bytes, need at least 9)` }
      }

      const responseTransactionId = data.readUInt16BE(0)
      const responseFunctionCode = data.readUInt8(7)
      const statusCode = data.readUInt8(8)

      if (responseTransactionId !== transactionId) {
        return { success: false, error: 'Transaction ID mismatch' }
      }

      if (responseFunctionCode !== (ModbusFunctionCode.DEBUG_SET as number)) {
        return { success: false, error: 'Function code mismatch' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_BOUNDS as number)) {
        return { success: false, error: 'ERROR_OUT_OF_BOUNDS' }
      }

      if (statusCode === (ModbusDebugResponse.ERROR_OUT_OF_MEMORY as number)) {
        return { success: false, error: 'ERROR_OUT_OF_MEMORY' }
      }

      if (statusCode !== (ModbusDebugResponse.SUCCESS as number)) {
        return { success: false, error: `Unknown error code: 0x${statusCode.toString(16)}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
