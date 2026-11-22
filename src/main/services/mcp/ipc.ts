import { randomUUID } from 'crypto'
import { app, BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

import { emptyMcpState, McpCapture, mcpCaptureSchema, McpState } from '../../../types/IPC/mcp'
import { plcAiSettingsSchema } from '../../../types/plc-operations/ai-settings'
import { debugExecuteSchema } from '../../../types/plc-operations/debugger'
import { PlcOperationsService } from '../plc-operations/service'
import { McpBroker } from './broker'
import { LocalMcpServer } from './server'

export function registerMcpIpc(ipc: IpcMain, window: BrowserWindow, operations: PlcOperationsService) {
  let reads = new Map<string, { resolve: (capture: McpCapture) => void; reject: (e: Error) => void }>()
  let starting = false
  let epoch = 0
  let visibleReviewId: string | null = null
  const state = (): McpState => ({
    ...emptyMcpState,
    ...listener.connection(),
    enabled: !!listener.connection(),
    ...broker.state(),
  })
  const notify = () => {
    if (window.isDestroyed()) return
    const next = state()
    window.webContents.send('mcp:state', next)
    const reviewId =
      next.pending && next.results.some((r) => r.id === next.pending?.id && r.status === 'review-required')
        ? next.pending.id
        : null
    if (reviewId && reviewId !== visibleReviewId) {
      // The request often comes from another foreground app. Make the host review visible there too.
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
    visibleReviewId = reviewId
  }
  const broker = new McpBroker(
    () =>
      new Promise<McpCapture>((resolve, reject) => {
        const id = randomUUID()
        const timeout = setTimeout(() => {
          reads.delete(id)
          reject(new Error('Editor did not provide project context.'))
        }, 5000)
        reads.set(id, {
          resolve: (capture) => {
            clearTimeout(timeout)
            reads.delete(id)
            resolve(capture)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reads.delete(id)
            reject(error)
          },
        })
        window.webContents.send('mcp:capture', id)
      }),
    notify,
    (request) => {
      if (request.action.operation === 'debug') operations.closeDebugger('mcp')
    },
  )
  const listener = new LocalMcpServer(broker)
  const stop = () => {
    epoch++
    listener.stop()
    broker.reset()
    for (const read of reads.values()) read.reject(new Error('MCP stopped.'))
    reads = new Map()
    operations.closeDebugger('mcp')
    notify()
  }
  const trusted = (event: IpcMainInvokeEvent) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Invalid MCP IPC sender.')
  }
  ipc.handle('mcp:state', (event) => {
    trusted(event)
    return state()
  })
  ipc.handle('mcp:configure', (event, settings: unknown) => {
    trusted(event)
    broker.configure(plcAiSettingsSchema.parse(settings))
  })
  ipc.handle('mcp:enable', async (event, path: unknown, settings: unknown) => {
    trusted(event)
    if (starting) throw new Error('MCP is starting.')
    const project = z.string().min(1).max(4096).parse(path)
    stop()
    const run = epoch
    starting = true
    try {
      operations.selectProject(project)
      broker.activate(project, settings === undefined ? null : plcAiSettingsSchema.parse(settings))
      await listener.start()
      if (run !== epoch) {
        listener.stop()
        throw new Error('MCP start cancelled.')
      }
      notify()
      return state()
    } finally {
      starting = false
    }
  })
  ipc.handle('mcp:stop', (event) => {
    trusted(event)
    stop()
    return state()
  })
  ipc.handle('mcp:capture-result', (event, id: unknown, capture: unknown) => {
    trusted(event)
    const read = reads.get(z.string().uuid().parse(id))
    if (read) {
      const parsed = mcpCaptureSchema.safeParse(capture)
      if (parsed.success) read.resolve(parsed.data)
      else read.reject(new Error('No valid current project context.'))
    }
  })
  ipc.handle('mcp:claim', (event, id: unknown) => {
    trusted(event)
    return broker.claim(z.string().uuid().parse(id))
  })
  ipc.handle('mcp:complete', (event, id: unknown, success: unknown, value: unknown) => {
    trusted(event)
    broker.complete(z.string().uuid().parse(id), z.boolean().parse(success), value)
  })
  ipc.handle('mcp:cancel', (event, id: unknown) => {
    trusted(event)
    return broker.cancel(z.string().uuid().parse(id))
  })
  ipc.handle('mcp:compile', (event, id: unknown, input: unknown) => {
    trusted(event)
    broker.assertExecuting(z.string().uuid().parse(id), 'compile')
    return operations.compile(input)
  })
  ipc.handle('mcp:debug', (event, id: unknown, input: unknown) => {
    trusted(event)
    const pending = broker.assertExecuting(z.string().uuid().parse(id), 'debug')
    const request = debugExecuteSchema.parse(input)
    if (
      pending.action.operation !== 'debug' ||
      JSON.stringify(request.command) !== JSON.stringify(pending.action.command) ||
      request.projectPath !== pending.capture.projectPath
    )
      throw new Error('Debugger approval does not match the request.')
    return operations.executeDebug(request, 'mcp')
  })
  ipc.handle('mcp:debug-close', (event) => {
    trusted(event)
    operations.closeDebugger('mcp')
  })
  window.once('closed', stop)
  app.once('before-quit', stop)
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) stop()
  })
}
