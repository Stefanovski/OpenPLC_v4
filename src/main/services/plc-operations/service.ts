import { debugExecuteSchema } from '../../../types/plc-operations/debugger'
import type { PlcBuildService } from './build'
import type { PlcDebugger } from './debugger'

type Builds = Pick<PlcBuildService, 'active' | 'compile'>
type Debugger = Pick<PlcDebugger, 'active' | 'generation' | 'execute' | 'close' | 'context'>

/** One instance per editor window, shared by every provider adapter. No account/chat/runtime dependency. */
export class PlcOperationsService {
  private projectPath: string | null = null
  private debuggerOwner: string | null = null
  private debugPending: symbol | null = null
  constructor(
    private readonly builds: Builds,
    private readonly debuggerService: Debugger,
    private readonly readBoards: () => Promise<Record<string, { compiler?: string }>>,
  ) {}

  selectProject(projectPath: string | null) {
    if (projectPath !== this.projectPath) this.closeDebugger()
    this.projectPath = projectPath
  }

  compile(input: unknown) {
    if (this.debugPending || this.debuggerService.active())
      throw new Error('Disconnect the PLC operations debugger before compiling.')
    return this.builds.compile(input)
  }

  async executeDebug(input: unknown, owner = 'default') {
    if (!this.debuggerOwner && this.debuggerService.active())
      throw new Error('Wait for the previous debugger operation to close.')
    if (this.debuggerOwner && this.debuggerOwner !== owner) throw new Error('Another provider owns the PLC debugger.')
    if (this.debugPending) throw new Error('A debugger operation is already running.')
    if (this.builds.active()) throw new Error('Wait for the PLC compilation to finish.')
    const generation = this.debuggerService.generation()
    const request = debugExecuteSchema.parse(input)
    if (request.projectPath !== this.projectPath) throw new Error('Active project changed.')
    const lease = Symbol()
    this.debugPending = lease
    this.debuggerOwner = owner
    try {
      const boards = await this.readBoards()
      if (!Object.hasOwn(boards, request.board) || boards[request.board].compiler !== 'eurosonic-cli')
        throw new Error('Active PLC debugging supports Eurosonic Modbus TCP targets only.')
      if (generation !== this.debuggerService.generation() || request.projectPath !== this.projectPath)
        throw new Error('Debugger request cancelled or project changed.')
      if (this.builds.active()) throw new Error('Wait for the PLC compilation to finish.')
      if (this.debuggerOwner && this.debuggerOwner !== owner) throw new Error('Another provider owns the PLC debugger.')
      return await this.debuggerService.execute(request)
    } finally {
      if (this.debugPending === lease) {
        this.debugPending = null
        if (!this.debuggerService.active()) this.debuggerOwner = null
      }
    }
  }

  debugContext() {
    return this.debuggerService.context()
  }
  closeDebugger(owner?: string) {
    if (owner && owner !== this.debuggerOwner) return
    this.debuggerService.close()
    this.debuggerOwner = null
    this.debugPending = null
  }
  dispose() {
    this.selectProject(null)
  }
}
