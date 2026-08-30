export type TelnetConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type TelnetEvent =
  | { type: 'data'; data: string }
  | { type: 'status'; status: TelnetConnectionStatus; message?: string }

export type TelnetOperationResult = {
  success: boolean
  error?: string
}
