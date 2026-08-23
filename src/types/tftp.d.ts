declare module 'tftp' {
  interface PutStream extends NodeJS.WritableStream {
    abort: (error?: Error | string) => void
  }

  interface Client {
    createPutStream: (remoteName: string, options: { size: number }) => PutStream
  }

  export function createClient(options: { host: string; port: number; retries: number; timeout: number }): Client
}
