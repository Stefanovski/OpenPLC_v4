const TELNET_IAC = 255
const TELNET_DONT = 254
const TELNET_DO = 253
const TELNET_WONT = 252
const TELNET_WILL = 251
const TELNET_SB = 250
const TELNET_SE = 240
const TELNET_ECHO = 1
const TELNET_SUPPRESS_GO_AHEAD = 3

type DecoderState = 'data' | 'iac' | 'option' | 'subnegotiation' | 'subnegotiation-iac'

export class TelnetStreamDecoder {
  private state: DecoderState = 'data'
  private optionCommand = 0

  decode(chunk: Buffer): { text: string; replies: Buffer[] } {
    const output: number[] = []
    const replies: Buffer[] = []

    for (const byte of chunk) {
      switch (this.state) {
        case 'data':
          if (byte === TELNET_IAC) {
            this.state = 'iac'
          } else if (byte !== 0) {
            output.push(byte)
          }
          break

        case 'iac':
          if (byte === TELNET_IAC) {
            output.push(byte)
            this.state = 'data'
          } else if ([TELNET_DO, TELNET_DONT, TELNET_WILL, TELNET_WONT].includes(byte)) {
            this.optionCommand = byte
            this.state = 'option'
          } else if (byte === TELNET_SB) {
            this.state = 'subnegotiation'
          } else {
            this.state = 'data'
          }
          break

        case 'option':
          if (this.optionCommand === TELNET_DO) {
            replies.push(Buffer.from([TELNET_IAC, TELNET_WONT, byte]))
          } else if (this.optionCommand === TELNET_WILL) {
            const response = byte === TELNET_ECHO || byte === TELNET_SUPPRESS_GO_AHEAD ? TELNET_DO : TELNET_DONT
            replies.push(Buffer.from([TELNET_IAC, response, byte]))
          }
          this.state = 'data'
          break

        case 'subnegotiation':
          if (byte === TELNET_IAC) this.state = 'subnegotiation-iac'
          break

        case 'subnegotiation-iac':
          this.state = byte === TELNET_SE ? 'data' : 'subnegotiation'
          break
      }
    }

    return { text: Buffer.from(output).toString('utf8'), replies }
  }
}
