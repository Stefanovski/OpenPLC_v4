import { randomUUID } from 'crypto'

import { McpAction, mcpActionSchema, McpCapture, mcpCaptureSchema, McpRequest, McpResult } from '../../../types/IPC/mcp'
import { describePlcContext, parsePlcContext } from '../../../types/plc-operations/context'
import { describePlcDebug } from '../../../types/plc-operations/debug-observations'

/** A tool call requests review, never grants permission. Only trusted editor IPC can claim it. */
export class McpBroker {
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

  activate(project: string) {
    this.reset()
    this.project = project
  }
  reset() {
    this.epoch++
    clearTimeout(this.timer)
    this.project = null
    this.snapshots.clear()
    this.pending = null
    this.requests.clear()
    this.notify()
  }
  state() {
    return { pending: this.pending, results: [...this.requests.values()] }
  }
  async context() {
    if (!this.project) throw new Error('MCP is disabled.')
    const epoch = this.epoch
    const capture = mcpCaptureSchema.parse(await this.capture())
    if (epoch !== this.epoch || capture.projectPath !== this.project) throw new Error('Project changed or MCP stopped.')
    const snapshotId = randomUUID()
    this.snapshots.set(snapshotId, { capture, expires: Date.now() + 120000 })
    while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value!)
    return {
      snapshotId,
      context: describePlcContext(parsePlcContext(capture.context.snapshot)),
      debugger: describePlcDebug(capture.debugger),
    }
  }
  submit(input: unknown): McpResult {
    if (!this.project) throw new Error('MCP is disabled.')
    if (this.pending) throw new Error('Another MCP request is awaiting review or executing.')
    if (JSON.stringify(input).length > 160000) throw new Error('Oversized MCP request.')
    const action = mcpActionSchema.parse(input)
    const snapshot = this.snapshots.get(action.snapshotId)
    if (!snapshot || snapshot.expires < Date.now())
      throw new Error('Snapshot expired or consumed. Read the context again.')
    this.snapshots.delete(action.snapshotId)
    const id = randomUUID()
    this.pending = { id, action, capture: snapshot.capture, createdAt: Date.now() }
    const result: McpResult = {
      id,
      operation: action.operation,
      status: 'review-required',
      detail: 'Awaiting approval in OpenPLC. Nothing has executed. Poll openplc_get_result.',
    }
    this.requests.set(id, result)
    while (this.requests.size > 8) this.requests.delete(this.requests.keys().next().value!)
    this.timer = setTimeout(() => this.cancel(id, 'Review expired; nothing executed.'), 120000)
    this.notify()
    return result
  }
  result(id: string) {
    const result = this.requests.get(id)
    if (!result) throw new Error('Unknown or expired request.')
    return result
  }
  claim(id: string): McpRequest {
    if (!this.pending || this.pending.id !== id || this.result(id).status !== 'review-required')
      throw new Error('Request is no longer awaiting approval.')
    clearTimeout(this.timer)
    this.requests.set(id, { ...this.result(id), status: 'executing', detail: 'Approved in OpenPLC; executing.' })
    this.notify()
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
    this.notify()
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
    this.notify()
    return this.result(id)
  }
}
