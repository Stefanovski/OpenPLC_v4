import { randomUUID } from 'crypto'
import { isIP } from 'net'

import { debugExecuteSchema, isDebugExecution,PlcDebugResult } from '../../../types/plc-operations/debugger'
import { IecDebugState, ModbusTcpClient } from '../../modules/modbus/modbus-client'
import { loadVerifiedDebugSource } from './debug-source'

type Client = Pick<
  ModbusTcpClient,
  | 'connect'
  | 'disconnect'
  | 'getMd5Hash'
  | 'getIecDebugCapabilities'
  | 'getIecDebugStatus'
  | 'getIecDebugCallStack'
  | 'readIecDebugVariable'
  | 'setIecDebugBreakpoint'
  | 'clearIecDebugBreakpoint'
  | 'continueIecDebug'
  | 'stepIntoIecDebug'
  | 'stepOverIecDebug'
  | 'stepOutIecDebug'
>
type Source = Awaited<ReturnType<typeof loadVerifiedDebugSource>>
const format = (type: number, raw: number[] | Buffer) => {
  const b = Array.isArray(raw) ? Buffer.from(raw) : raw
  if (type === 1 && b.length === 1) return b[0] ? 'TRUE' : 'FALSE'
  if (type === 2 && b.length === 1) return String(b.readInt8())
  if ([3, 17].includes(type) && b.length === 1) return String(b.readUInt8())
  if (type === 4 && b.length === 2) return String(b.readInt16LE())
  if ([5, 18].includes(type) && b.length === 2) return String(b.readUInt16LE())
  if (type === 6 && b.length === 4) return String(b.readInt32LE())
  if ([7, 19].includes(type) && b.length === 4) return String(b.readUInt32LE())
  if (type === 8 && b.length === 8) return String(b.readBigInt64LE())
  if ([9, 20].includes(type) && b.length === 8) return String(b.readBigUInt64LE())
  if (type === 10 && b.length === 4) return String(b.readFloatLE())
  if (type === 11 && b.length === 8) return String(b.readDoubleLE())
  return '0x' + b.toString('hex').slice(0, 256)
}

/** Own connection; no compiler/uploader dependency and no implicit resume/clear on disconnect. */
export class PlcDebugger {
  private session: {
    id: string
    host: string
    board: string
    projectPath: string
    source: Source
    client: Client
    watch: string[]
  } | null = null
  private pendingClient: Client | null = null
  private epoch = 0
  private busy = false
  private result: PlcDebugResult | null = null
  constructor(
    private load = loadVerifiedDebugSource,
    private makeClient: (host: string) => Client = (host) => new ModbusTcpClient({ host, port: 502, timeout: 5000 }),
  ) {}
  context() {
    return this.result ? structuredClone(this.result) : null
  }
  active() {
    return this.busy || this.session !== null
  }
  generation() {
    return this.epoch
  }
  close() {
    this.epoch++
    this.pendingClient?.disconnect()
    this.session?.client.disconnect()
    this.pendingClient = null
    this.session = null
    this.result = {
      success: true,
      sessionId: null,
      host: null,
      sampledAt: Date.now(),
      operation: 'connection closed; PLC execution and breakpoints unchanged',
    }
  }
  async execute(input: unknown): Promise<PlcDebugResult> {
    if (this.busy) throw new Error('A debugger operation is already running.')
    if (JSON.stringify(input).length > 2000000) throw new Error('Oversized debugger request.')
    const request = debugExecuteSchema.parse(input)
    if (!isIP(request.host)) throw new Error('Select a concrete target IP in Configuration first.')
    if (isDebugExecution(request.command.operation) && !request.confirmExecution)
      throw new Error('Explicit command confirmation is required.')
    if (request.command.operation === 'disconnect') {
      if (this.session && request.sessionId !== this.session.id) throw new Error('Debugger session changed.')
      this.close()
      return {
        success: true,
        sessionId: null,
        host: null,
        sampledAt: Date.now(),
        operation: 'disconnect (PLC execution and breakpoints unchanged)',
      }
    }
    this.busy = true
    const epoch = this.epoch
    const check = () => {
      if (epoch !== this.epoch) throw new Error('Debugger action cancelled. No further commands will be sent.')
    }
    try {
      const source = await this.load(request)
      check()
      if (request.command.operation === 'connect') {
        if (this.session) throw new Error('Disconnect the existing PLC operations debugger session first.')
        const client = this.makeClient(request.host)
        this.pendingClient = client
        await client.connect()
        check()
        this.session = {
          id: randomUUID(),
          host: request.host,
          board: request.board,
          projectPath: request.projectPath,
          source,
          client,
          watch: [],
        }
        this.pendingClient = null
      }
      const session = this.session
      if (
        !session ||
        (request.command.operation !== 'connect' && request.sessionId !== session.id) ||
        session.host !== request.host ||
        session.board !== request.board ||
        session.projectPath !== request.projectPath ||
        session.source.identity !== source.identity
      )
        throw new Error('Debugger session, target or build changed. Reconnect explicitly.')
      const { client } = session
      const md5 = await client.getMd5Hash()
      check()
      if (md5.toLowerCase() !== source.md5)
        throw new Error('PLC program does not match local debug build. No compilation/download was started.')
      const capabilities = await client.getIecDebugCapabilities()
      check()
      const before = await client.getIecDebugStatus()
      check()
      const { operation, statementId, variables } = request.command
      const all = source.metadata.variables
      const names = variables.length
        ? variables
        : session.watch.length
          ? session.watch
          : all.slice(0, 12).map((v) => v.path)
      const watch = names.map((name) => {
        const key = name.toUpperCase()
        const exact = all.filter((v) => v.path.toUpperCase() === key)
        const matches = exact.length ? exact : all.filter((v) => v.path.toUpperCase().endsWith('.' + key))
        if (matches.length !== 1)
          throw new Error(`Variable '${name}' is missing or ambiguous; use the full catalog path.`)
        return matches[0]
      })
      if (watch.length && !(capabilities & (1 << 2))) throw new Error('Reading variables is unsupported.')
      if (operation === 'set-breakpoint' || operation === 'clear-breakpoint') {
        if (!(capabilities & 1)) throw new Error('Breakpoints are unsupported.')
        if (!source.metadata.statements.some((s) => s.id === statementId))
          throw new Error('Unknown breakpoint statement ID.')
        if (operation === 'set-breakpoint') await client.setIecDebugBreakpoint(statementId)
        else await client.clearIecDebugBreakpoint(statementId)
      } else if (['continue', 'step-into', 'step-over', 'step-out'].includes(operation)) {
        if (before.state !== IecDebugState.HALTED) throw new Error('The PLC is not halted. Execution command refused.')
        if (operation === 'step-into' && !(capabilities & (1 << 1))) throw new Error('Step into is unsupported.')
        if (operation === 'step-over' && !(capabilities & (1 << 5))) throw new Error('Step over is unsupported.')
        if (operation === 'step-out' && !(capabilities & (1 << 6))) throw new Error('Step out is unsupported.')
        if (operation === 'continue') await client.continueIecDebug()
        if (operation === 'step-into') await client.stepIntoIecDebug()
        if (operation === 'step-over') await client.stepOverIecDebug()
        if (operation === 'step-out') await client.stepOutIecDebug()
      }
      check()
      const values: NonNullable<PlcDebugResult['values']> = []
      for (const variable of watch) {
        check()
        const value = await client.readIecDebugVariable(variable.id, variable.type_code)
        check()
        if (value.type !== variable.type_code) throw new Error('Variable type changed.')
        values.push({
          path: variable.path,
          type: variable.type,
          value: format(value.type, value.value),
          forced: value.forced,
        })
      }
      session.watch = watch.map((v) => v.path)
      let status = await client.getIecDebugStatus()
      check()
      let stack: NonNullable<PlcDebugResult['stack']> = []
      if (status.state === IecDebugState.HALTED && capabilities & (1 << 7)) {
        stack = await client.getIecDebugCallStack()
        check()
        const confirmed = await client.getIecDebugStatus()
        check()
        if (confirmed.state !== IecDebugState.HALTED || confirmed.haltCount !== status.haltCount) stack = []
        status = confirmed
      }
      this.result = {
        success: true,
        sessionId: session.id,
        host: session.host,
        sampledAt: Date.now(),
        sourceMatch: 'verified',
        capabilities,
        operation,
        status: {
          state: status.state,
          statementId: status.currentStatementId,
          pouId: status.currentPouId,
          instanceId: status.currentInstanceId,
          haltCount: String(status.haltCount),
          pointCount: String(status.pointCount),
        },
        values,
        stack: stack.slice(0, 32),
        catalog: {
          variables: all.slice(0, 256).map((v) => ({ path: v.path.slice(0, 256), type: v.type })),
          statements: source.metadata.statements.slice(0, 256).map((s) => ({
            id: s.id,
            pou: source.metadata.pous.find((p) => p.id === s.pou_id)?.name ?? '',
            line: s.line,
          })),
          truncated: all.length > 256 || source.metadata.statements.length > 256,
        },
      }
      return this.context()!
    } catch (error) {
      this.close()
      const errorText = (error instanceof Error ? error.message : 'Debugger failed')
        .replaceAll('\\', '/')
        .split(request.projectPath.replaceAll('\\', '/'))
        .join('[project]')
      this.result = {
        success: false,
        sessionId: null,
        host: request.host,
        sampledAt: Date.now(),
        error: `${errorText}. Connection released; PLC execution/breakpoints were not reset. A command already sent cannot be undone by cancellation.`,
      }
      return this.context()!
    } finally {
      this.busy = false
    }
  }
}
