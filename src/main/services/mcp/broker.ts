import { randomUUID } from 'crypto'

import { McpAction, mcpActionSchema, McpCapture, mcpCaptureSchema, McpRequest, McpResult } from '../../../types/IPC/mcp'
import { mcpDisposition, PlcAiSettings } from '../../../types/plc-operations/ai-settings'
import { describePlcContext, parsePlcContext } from '../../../types/plc-operations/context'
import { describePlcDebug } from '../../../types/plc-operations/debug-observations'

/** Only trusted editor settings/IPC authorize execution; model arguments never grant permission. */
export class McpBroker {
  private settings: PlcAiSettings | null = null
  private waiters = new Set<() => void>()
  private epoch = 0
  private project: string | null = null
  private snapshots = new Map<string, { capture: McpCapture; expires: number }>()
  private requests = new Map<string, McpResult>()
  private pending: McpRequest | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(
    private readonly capture: () => Promise<McpCapture>,
    private readonly notify: () => void,
    private readonly cancelled: (request: McpRequest) => void = () => {},
  ) {}

  activate(project: string, settings: PlcAiSettings | null = null) {
    this.reset()
    this.project = project
    this.settings = settings
  }
  configure(settings: PlcAiSettings) {
    this.settings = settings
    if (!settings.includeContext) this.snapshots.clear()
    if (this.pending) {
      const id = this.pending.id
      try {
        const status = mcpDisposition(this.pending.action, settings)
        if (this.result(id).status !== 'executing')
          this.requests.set(id, { ...this.result(id), status, detail: this.detail(status) })
      } catch (error) {
        this.cancel(id, error instanceof Error ? error.message : 'AI permission revoked.')
      }
    }
    this.changed()
  }
  private detail(status: 'queued' | 'review-required') {
    return status === 'queued'
      ? 'Accepted under shared AI settings; waiting for the editor to execute. Not completed yet.'
      : 'User review required in OpenPLC: open MCP in the left activity bar and select Approve MCP request. The review dialog opens automatically. Tell the user now; do not repeatedly poll while awaiting approval.'
  }
  private changed() {
    this.notify()
    for (const wake of [...this.waiters]) wake()
  }
  async submitAndWait(input: unknown) {
    return this.waitForResult(this.submit(input).id)
  }
  waitForResult(id: string): Promise<McpResult> {
    const initial = this.result(id)
    if (!['queued', 'executing'].includes(initial.status)) return Promise.resolve(initial)
    // Complete quick editor edits in the original tool call; builds may return executing.
    return new Promise((resolve) => {
      const finish = (result: McpResult) => {
        clearTimeout(timer)
        this.waiters.delete(wake)
        resolve(result)
      }
      const current = () =>
        this.requests.get(id) ?? { ...initial, status: 'cancelled' as const, detail: 'MCP stopped.' }
      const wake = () => {
        const result = current()
        if (!['queued', 'executing'].includes(result.status)) finish(result)
      }
      const timer = setTimeout(() => finish(current()), 1500)
      this.waiters.add(wake)
      wake()
    })
  }
  reset() {
    this.epoch++
    clearTimeout(this.timer)
    this.project = null
    this.snapshots.clear()
    this.pending = null
    this.requests.clear()
    this.settings = null
    this.changed()
  }
  state() {
    return { pending: this.pending, results: [...this.requests.values()] }
  }
  async context() {
    if (!this.project) throw new Error('MCP is disabled.')
    if (this.settings && !this.settings.includeContext)
      throw new Error('Project access is disabled in the shared AI settings.')
    const epoch = this.epoch
    const capture = mcpCaptureSchema.parse(await this.capture())
    if (epoch !== this.epoch || capture.projectPath !== this.project) throw new Error('Project changed or MCP stopped.')
    if (this.settings && !this.settings.includeContext)
      throw new Error('Project access is disabled in the shared AI settings.')
    const snapshotId = randomUUID()
    this.snapshots.set(snapshotId, { capture, expires: Date.now() + 120000 })
    while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value!)
    return {
      snapshotId,
      context: describePlcContext(parsePlcContext(capture.context.snapshot)),
      settings: this.settings,
      capabilities: {
        edits:
          'Create/update ST programs, functions and function blocks; C++ function blocks; add program instances. No graphical POU editing.',
        editMode: this.settings?.directEdits ? 'direct-with-undo' : 'review',
        compile: 'Only on explicit user request. Isolated build; no save or PLC download.',
        debug:
          'Connect/observe/disconnect when enabled. Breakpoints and execution commands require visible confirmation.',
        unavailable: ['save', 'PLC download', 'force IO', 'RUN/STOP', 'arbitrary files or shell'],
      },
      debugger: !this.settings || this.settings.includeDebugger ? describePlcDebug(capture.debugger) : null,
    }
  }
  submit(input: unknown): McpResult {
    if (!this.project) throw new Error('MCP is disabled.')
    if (this.pending) throw new Error('Another MCP request is awaiting review or executing.')
    if (JSON.stringify(input).length > 160000) throw new Error('Oversized MCP request.')
    const action = mcpActionSchema.parse(input)
    const status = mcpDisposition(action, this.settings)
    const snapshot = this.snapshots.get(action.snapshotId)
    if (!snapshot || snapshot.expires < Date.now())
      throw new Error('Snapshot expired or consumed. Read the context again.')
    this.snapshots.delete(action.snapshotId)
    const id = randomUUID()
    this.pending = { id, action, capture: snapshot.capture, createdAt: Date.now() }
    const result: McpResult = {
      id,
      operation: action.operation,
      status,
      detail: this.detail(status),
    }
    this.requests.set(id, result)
    while (this.requests.size > 8) this.requests.delete(this.requests.keys().next().value!)
    this.timer = setTimeout(() => this.cancel(id, 'Request expired before execution; nothing executed.'), 120000)
    this.changed()
    return result
  }
  result(id: string) {
    const result = this.requests.get(id)
    if (!result) throw new Error('Unknown or expired request.')
    return result
  }
  claim(id: string): McpRequest {
    if (!this.pending || this.pending.id !== id || !['queued', 'review-required'].includes(this.result(id).status))
      throw new Error('Request is no longer awaiting approval.')
    mcpDisposition(this.pending.action, this.settings)
    clearTimeout(this.timer)
    this.requests.set(id, { ...this.result(id), status: 'executing', detail: 'Authorized by OpenPLC; executing.' })
    this.changed()
    return this.pending
  }
  assertExecuting(id: string, operation: McpAction['operation']) {
    if (
      !this.pending ||
      this.pending.id !== id ||
      this.pending.action.operation !== operation ||
      this.result(id).status !== 'executing'
    )
      throw new Error('No matching approved MCP operation.')
    return this.pending
  }
  complete(id: string, success: boolean, value: unknown) {
    if (!this.pending || this.pending.id !== id || this.result(id).status !== 'executing') return
    const encoded = JSON.stringify(value)
    if (encoded.length > 400000) throw new Error('Oversized operation result.')
    this.requests.set(id, {
      ...this.result(id),
      status: success ? 'completed' : 'failed',
      detail: success ? 'Operation completed.' : 'Operation failed; see result.',
      value,
    })
    this.pending = null
    this.changed()
  }
  cancel(
    id: string,
    detail = 'Cancelled. Completed effects are not rolled back; an isolated build may finish in the background.',
  ) {
    if (!this.pending || this.pending.id !== id) return this.result(id)
    clearTimeout(this.timer)
    this.requests.set(id, { ...this.result(id), status: 'cancelled', detail })
    this.cancelled(this.pending)
    this.pending = null
    this.changed()
    return this.result(id)
  }
}
