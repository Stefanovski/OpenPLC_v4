import '@xterm/xterm/css/xterm.css'

import type { TelnetConnectionStatus, TelnetEvent } from '@root/types/telnet'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'

type TelnetTerminalProps = {
  host: string
}

export const TelnetTerminal = ({ host }: TelnetTerminalProps) => {
  const [status, setStatus] = useState<TelnetConnectionStatus>('disconnected')
  const terminalElementRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const statusRef = useRef<TelnetConnectionStatus>('disconnected')
  const hostRef = useRef(host)

  useEffect(() => {
    const terminalElement = terminalElementRef.current
    if (!terminalElement) return undefined

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: true,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.1,
      scrollback: 5000,
      theme: {
        background: '#000000',
        foreground: '#d4d4d4',
        cursor: '#00ff00',
        cursorAccent: '#000000',
        selectionBackground: '#264f78',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(terminalElement)
    terminalRef.current = terminal

    const fitTerminal = () => {
      if (terminalElement.clientWidth > 0 && terminalElement.clientHeight > 0) fitAddon.fit()
    }
    const initialFitFrame = window.requestAnimationFrame(fitTerminal)
    const resizeObserver = new ResizeObserver(fitTerminal)
    resizeObserver.observe(terminalElement)

    terminal.writeln('\x1b[90mSelect a generator IP and press Connect.\x1b[0m')
    const dataSubscription = terminal.onData((data) => {
      if (statusRef.current !== 'connected') return
      const telnetData = data === '\r' ? '\r\n' : data
      void window.electronAPI.telnetWrite(telnetData).then((result) => {
        if (!result.success) terminal.writeln(`\r\n\x1b[31m[Error: ${result.error || 'Could not send data'}]\x1b[0m`)
      })
    })

    return () => {
      window.cancelAnimationFrame(initialFitFrame)
      resizeObserver.disconnect()
      dataSubscription.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [])

  useEffect(() => {
    statusRef.current = status
    const terminal = terminalRef.current
    if (!terminal) return

    terminal.options.disableStdin = status !== 'connected'
    if (status === 'connected') terminal.focus()
  }, [status])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTelnetEvent((event: TelnetEvent) => {
      const terminal = terminalRef.current
      if (!terminal) return

      if (event.type === 'data') {
        terminal.write(event.data)
        return
      }

      setStatus(event.status)
      if (event.status === 'connected') {
        terminal.writeln(`\r\n\x1b[90m[Connected to ${hostRef.current}:23]\x1b[0m`)
      } else if (event.status === 'disconnected') {
        terminal.writeln('\r\n\x1b[90m[Disconnected]\x1b[0m')
      } else if (event.status === 'error') {
        terminal.writeln(`\r\n\x1b[31m[Error: ${event.message || 'Connection failed'}]\x1b[0m`)
      }
    })

    return () => {
      unsubscribe()
      void window.electronAPI.telnetDisconnect()
    }
  }, [])

  useEffect(() => {
    const hostChanged = hostRef.current !== host
    hostRef.current = host
    if (hostChanged && statusRef.current !== 'disconnected') {
      setStatus('disconnected')
      void window.electronAPI.telnetDisconnect()
      terminalRef.current?.writeln('\r\n\x1b[90m[Generator IP changed]\x1b[0m')
    }
  }, [host])

  const handleConnect = async () => {
    if (!host.trim() || status === 'connecting' || status === 'connected') return
    terminalRef.current?.clear()
    terminalRef.current?.writeln(`\x1b[90m[Connecting to ${host.trim()}:23 ...]\x1b[0m`)
    await window.electronAPI.telnetConnect(host.trim())
  }

  const handleDisconnect = async () => {
    const result = await window.electronAPI.telnetDisconnect()
    if (result.success) {
      setStatus('disconnected')
    } else {
      terminalRef.current?.writeln(`\r\n\x1b[31m[Error: ${result.error || 'Could not disconnect'}]\x1b[0m`)
    }
  }

  const statusColor = {
    disconnected: 'bg-neutral-400',
    connecting: 'bg-amber-500',
    connected: 'bg-green-500',
    error: 'bg-red-500',
  }[status]

  return (
    <section className='flex min-h-[440px] flex-[1_0_440px] flex-col gap-2 pb-2' aria-label='Generator Telnet terminal'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <h3 className='text-sm font-semibold text-neutral-950 dark:text-white'>Generator Terminal</h3>
          <span className={`h-2 w-2 rounded-full ${statusColor}`} aria-hidden='true' />
          <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
            {host ? `${host}:23` : 'No generator IP selected'}
          </span>
        </div>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => void handleConnect()}
            disabled={!host.trim() || status === 'connecting' || status === 'connected'}
            className='h-[30px] rounded-md bg-brand px-4 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark disabled:cursor-not-allowed disabled:opacity-50'
          >
            {status === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
          <button
            type='button'
            onClick={() => void handleDisconnect()}
            disabled={status === 'disconnected'}
            className='h-[30px] rounded-md border border-neutral-300 px-4 font-caption text-cp-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-850'
          >
            Disconnect
          </button>
          <button
            type='button'
            onClick={() => terminalRef.current?.clear()}
            className='h-[30px] rounded-md border border-neutral-300 px-3 font-caption text-cp-sm font-medium text-neutral-800 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-850'
          >
            Clear
          </button>
        </div>
      </div>

      <div
        ref={terminalElementRef}
        className='min-h-[380px] flex-1 overflow-hidden rounded-md border border-neutral-800 bg-black p-2 [&_.xterm]:h-full'
        onClick={() => terminalRef.current?.focus()}
        role='application'
        aria-label='Interactive generator terminal'
      />
    </section>
  )
}
