import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcMain } from 'electron'
import { Socket } from 'net'

import type { TelnetEvent, TelnetOperationResult } from '../../../types/telnet'
import { TelnetStreamDecoder } from './telnet-protocol'

const TELNET_PORT = 23
const CONNECT_TIMEOUT_MS = 5000
const DISCONNECT_GRACE_PERIOD_MS = 500

type TelnetSession = {
  socket: Socket
  webContents: WebContents
  decoder: TelnetStreamDecoder
  connected: boolean
  failed: boolean
}

export class TelnetModule {
  private session: TelnetSession | null = null

  constructor() {
    ipcMain.handle('telnet:connect', this.handleConnect)
    ipcMain.handle('telnet:disconnect', this.handleDisconnect)
    ipcMain.handle('telnet:write', this.handleWrite)
  }

  private emit(webContents: WebContents, event: TelnetEvent): void {
    if (!webContents.isDestroyed()) webContents.send('telnet:event', event)
  }

  private closeSession(notifyRenderer: boolean): void {
    const session = this.session
    if (!session) return

    this.session = null
    if (notifyRenderer) {
      this.emit(session.webContents, { type: 'status', status: 'disconnected' })
    }

    session.socket.end()
    const destroyTimer = setTimeout(() => session.socket.destroy(), DISCONNECT_GRACE_PERIOD_MS)
    destroyTimer.unref()
  }

  private handleConnect = async (event: IpcMainInvokeEvent, requestedHost: string): Promise<TelnetOperationResult> => {
    const host = requestedHost.trim()
    if (!host) return { success: false, error: 'No generator IP address configured.' }

    this.closeSession(false)
    this.emit(event.sender, { type: 'status', status: 'connecting' })

    return new Promise((resolve) => {
      const socket = new Socket()
      const session: TelnetSession = {
        socket,
        webContents: event.sender,
        decoder: new TelnetStreamDecoder(),
        connected: false,
        failed: false,
      }
      let resolved = false

      const resolveOnce = (result: TelnetOperationResult) => {
        if (resolved) return
        resolved = true
        resolve(result)
      }

      const fail = (message: string) => {
        if (this.session !== session) return
        session.failed = true
        this.emit(event.sender, { type: 'status', status: 'error', message })
        resolveOnce({ success: false, error: message })
      }

      this.session = session
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 5000)

      const connectTimer = setTimeout(() => {
        fail(`Connection to ${host}:${TELNET_PORT} timed out.`)
        socket.destroy()
      }, CONNECT_TIMEOUT_MS)
      connectTimer.unref()

      socket.once('connect', () => {
        clearTimeout(connectTimer)
        if (this.session !== session) {
          socket.destroy()
          return
        }

        session.connected = true
        this.emit(event.sender, { type: 'status', status: 'connected' })
        resolveOnce({ success: true })
      })

      socket.on('data', (chunk) => {
        if (this.session !== session) return
        const decoded = session.decoder.decode(chunk)
        decoded.replies.forEach((reply) => socket.write(new Uint8Array(reply)))
        if (decoded.text) this.emit(event.sender, { type: 'data', data: decoded.text })
      })

      socket.on('error', (error) => {
        clearTimeout(connectTimer)
        fail(error.message)
      })

      socket.once('close', () => {
        clearTimeout(connectTimer)
        if (this.session !== session) return

        this.session = null
        if (!session.failed) {
          this.emit(event.sender, { type: 'status', status: 'disconnected' })
        }
        resolveOnce({ success: false, error: 'Connection closed before it was established.' })
      })

      const handleWebContentsDestroyed = () => {
        if (this.session === session) this.closeSession(false)
      }
      event.sender.once('destroyed', handleWebContentsDestroyed)
      socket.once('close', () => event.sender.removeListener('destroyed', handleWebContentsDestroyed))

      socket.connect(TELNET_PORT, host)
    })
  }

  private handleDisconnect = (event: IpcMainInvokeEvent): TelnetOperationResult => {
    if (this.session && this.session.webContents.id === event.sender.id) this.closeSession(true)
    return { success: true }
  }

  private handleWrite = async (event: IpcMainInvokeEvent, data: string): Promise<TelnetOperationResult> => {
    const session = this.session
    if (!session || session.webContents.id !== event.sender.id || !session.connected || session.socket.destroyed) {
      return { success: false, error: 'Telnet is not connected.' }
    }

    return new Promise((resolve) => {
      session.socket.write(data, (error) => {
        if (error) {
          resolve({ success: false, error: error.message })
        } else {
          resolve({ success: true })
        }
      })
    })
  }
}
