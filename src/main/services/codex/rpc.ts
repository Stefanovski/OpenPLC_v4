import { ChildProcessWithoutNullStreams } from 'child_process'

export type RpcObject = Record<string, unknown>
export const object = (value: unknown): RpcObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RpcObject) : {}
export const string = (value: unknown): string => (typeof value === 'string' ? value : '')
export const safeError = (error: unknown): string =>
  (error instanceof Error ? error.message : 'Codex request failed.')
    .replace(/Bearer\s+\S+|sk-[\w-]+|eyJ[\w.-]+|(?:access_token|refresh_token|code)=([^&\s]+)/gi, '[redacted]')
    .slice(0, 1200)

/** Only JSONL protocol traffic is parsed. Stderr and credentials are never forwarded to the renderer. */
export class CodexRpc {
  private nextId = 0
  private buffer = ''
  private ended = false
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()

  constructor(
    private child: ChildProcessWithoutNullStreams,
    private onNotification: (method: string, params: RpcObject) => void,
    private onExit: (error: Error) => void,
    private timeoutMs = 60000,
  ) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.read(chunk))
    child.stderr.resume()
    child.stdin.on('error', () => this.close(new Error('Codex input connection closed.')))
    child.once('error', () => this.close(new Error('Could not start the selected Codex executable.')))
    child.once('exit', () => this.close(new Error('Codex stopped. Reconnect to start a new conversation.')))
  }

  request(method: string, params: RpcObject = {}): Promise<unknown> {
    if (this.ended) return Promise.reject(new Error('Codex is disconnected.'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.close(new Error(`Codex timed out (${method}). Reconnect to retry.`)),
        this.timeoutMs,
      )
      this.pending.set(id, { resolve, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: RpcObject = {}) {
    this.write({ method, params })
  }

  private write(message: RpcObject) {
    if (!this.ended) this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private read(chunk: string) {
    if (this.ended) return
    this.buffer += chunk
    if (this.buffer.length > 8 * 1024 * 1024)
      return this.close(new Error('Codex protocol frame exceeded its size limit.'))
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message: RpcObject
      try {
        message = object(JSON.parse(line))
      } catch {
        return this.close(new Error('Invalid Codex protocol response.'))
      }
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          // This stage has no project tools or approval UI. Never grant agent actions implicitly.
          if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method)) {
            this.write({ id: message.id, result: { decision: 'decline' } })
          } else if (message.method === 'item/permissions/requestApproval') {
            this.write({ id: message.id, result: { permissions: {}, scope: 'turn' } })
          } else if (message.method === 'item/tool/requestUserInput') {
            this.write({ id: message.id, result: { answers: {} } })
          } else {
            this.write({
              id: message.id,
              error: { code: -32601, message: 'This OpenPLC client does not support this tool.' },
            })
          }
        } else this.onNotification(message.method, object(message.params))
      } else if (typeof message.id === 'number') {
        const entry = this.pending.get(message.id)
        if (!entry) continue
        clearTimeout(entry.timer)
        this.pending.delete(message.id)
        if (message.error)
          entry.reject(
            new Error(safeError(new Error(string(object(message.error).message) || 'Codex rejected the request.'))),
          )
        else entry.resolve(message.result)
      }
    }
  }

  close(error = new Error('Codex disconnected.')) {
    if (this.ended) return
    this.ended = true
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
    // EOF lets app-server stop its own local hosts before the fallback terminates it.
    this.child.stdin.end()
    if (this.child.exitCode === null || this.child.exitCode === undefined) {
      const killTimer = setTimeout(() => this.child.kill(), 1500)
      killTimer.unref()
      this.child.once('exit', () => clearTimeout(killTimer))
    }
    this.onExit(error)
  }
}
