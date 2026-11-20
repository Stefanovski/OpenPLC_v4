import { app, BrowserWindow, dialog, IpcMain, IpcMainInvokeEvent, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'

import { codexContextAttachmentSchema } from '../../../types/IPC/codex-context'
import { codexDebugSnapshotSchema } from '../../../types/IPC/codex-debug'
import { debugExecuteSchema } from '../../../types/IPC/codex-debug-control'
import type { CompilerModule } from '../../modules/compiler/compiler-module'
import { CodexBuildService } from './build'
import { CodexDebugger } from './debugger'
import { startCodexRuntime } from './runtime'
import { CodexService } from './service'

const sendSchema = z
  .object({
    projectPath: z.string().min(1).max(4096),
    text: z.string().min(1).max(32000),
    model: z.string().min(1).max(200),
    context: codexContextAttachmentSchema.optional(),
    debugger: codexDebugSnapshotSchema.optional(),
    proposeChanges: z.boolean().optional(),
    scratchOnly: z.boolean().optional(),
    buildRequestId: z.string().uuid().optional(),
    applyRequestId: z.string().uuid().optional(),
    debugRequestId: z.string().uuid().optional(),
    debugFollowup: z.boolean().optional(),
  })
  .strict()

export function registerCodexIpc(ipc: IpcMain, window: BrowserWindow, compiler: CompilerModule) {
  const debuggerService = new CodexDebugger()
  window.on('closed', () => debuggerService.close())
  const builds = new CodexBuildService(compiler, join(app.getPath('userData'), 'codex-builds'))
  const profile = join(app.getPath('userData'), 'codex-profile')
  const settingsFile = join(app.getPath('userData'), 'codex-runtime.json')
  const service = new CodexService(
    async (notify, exit) => {
      let executable: string | undefined
      try {
        executable = z
          .object({ executable: z.string() })
          .parse(JSON.parse(await readFile(settingsFile, 'utf8'))).executable
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Invalid Codex runtime settings. Select the executable again.')
      }
      return startCodexRuntime(profile, executable, notify, exit)
    },
    (url) => shell.openExternal(url),
    (state) => {
      if (!window.isDestroyed()) window.webContents.send('codex:state', state)
    },
    () => debuggerService.context(),
  )
  const trusted = (event: IpcMainInvokeEvent) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Invalid Codex IPC sender.')
  }
  ipc.handle('codex:state', (event) => {
    trusted(event)
    return service.snapshot()
  })
  ipc.handle('codex:compile', (event, request: unknown) => {
    trusted(event)
    if (debuggerService.active()) throw new Error('Disconnect the Codex debugger before compiling.')
    return builds.compile(request)
  })
  ipc.handle('codex:debug-execute', async (event, input: unknown) => {
    trusted(event)
    if (builds.active()) throw new Error('Wait for the Codex compilation to finish.')
    const generation = debuggerService.generation()
    const request = debugExecuteSchema.parse(input)
    if (request.projectPath !== service.snapshot().projectPath) throw new Error('Active project changed.')
    const boards = JSON.parse(await readFile(compiler.halsFilePath, 'utf8')) as Record<string, { compiler?: string }>
    if (!Object.hasOwn(boards, request.board) || boards[request.board].compiler !== 'eurosonic-cli')
      throw new Error('Active Codex debugging supports Eurosonic Modbus TCP targets only.')
    if (generation !== debuggerService.generation() || request.projectPath !== service.snapshot().projectPath)
      throw new Error('Debugger request cancelled or project changed.')
    if (builds.active()) throw new Error('Wait for the Codex compilation to finish.')
    return debuggerService.execute(request)
  })
  ipc.handle('codex:debug-close', (event) => {
    trusted(event)
    debuggerService.close()
  })
  ipc.handle('codex:project', (event, project: unknown) => {
    trusted(event)
    if (project !== service.snapshot().projectPath) debuggerService.close()
    return service.run(() => service.selectProject(z.string().min(1).max(4096).nullable().parse(project)))
  })
  ipc.handle('codex:send', (event, request: unknown) => {
    trusted(event)
    return service.run(() => service.send(sendSchema.parse(request)))
  })
  ipc.handle('codex:action', (event, action: unknown) => {
    trusted(event)
    if (['disconnect', 'sign-out', 'new-chat', 'stop'].includes(String(action))) debuggerService.close()
    return service.run(async () => {
      switch (action) {
        case 'connect':
          return service.connect()
        case 'sign-in':
          return service.signIn()
        case 'cancel-login':
          return service.cancelLogin()
        case 'reopen-login':
          return service.reopenLogin()
        case 'sign-out':
          return service.signOut()
        case 'disconnect':
          return service.disconnect()
        case 'stop':
          return service.stop()
        case 'new-chat':
          return service.newChat()
        default:
          throw new Error('Unknown Codex action.')
      }
    })
  })
  ipc.handle('codex:select-runtime', (event) => {
    trusted(event)
    return service.run(async () => {
      if (
        service.snapshot().busy ||
        service.snapshot().operationPending ||
        service.snapshot().connection === 'connecting'
      )
        throw new Error('Stop the current Codex operation first.')
      const result = await dialog.showOpenDialog(window, {
        title: 'Select the native Codex CLI executable',
        properties: ['openFile'],
        filters: process.platform === 'win32' ? [{ name: 'Codex executable', extensions: ['exe'] }] : undefined,
      })
      if (result.canceled || !result.filePaths[0]) return
      service.disconnect()
      await writeFile(settingsFile, JSON.stringify({ executable: result.filePaths[0] }), { mode: 0o600 })
    })
  })
  const dispose = () => {
    debuggerService.close()
    service.disconnect()
  }
  app.once('before-quit', dispose)
  window.once('closed', () => {
    app.removeListener('before-quit', dispose)
    dispose()
  })
  window.webContents.on('render-process-gone', dispose)
  // A renderer reload must not leave an unseen model response running.
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) {
      debuggerService.close()
      service.selectProject(null)
    }
  })
}
