import { TelnetStreamDecoder } from './telnet-protocol'

describe('TelnetStreamDecoder', () => {
  it('passes normal terminal output through', () => {
    const decoder = new TelnetStreamDecoder()

    expect(decoder.decode(Buffer.from('Eurosonic> '))).toEqual({ text: 'Eurosonic> ', replies: [] })
  })

  it('rejects unsupported options even when negotiation is split across chunks', () => {
    const decoder = new TelnetStreamDecoder()

    expect(decoder.decode(Buffer.from([255, 251]))).toEqual({ text: '', replies: [] })
    expect(decoder.decode(Buffer.from([24, 79, 75]))).toEqual({
      text: 'OK',
      replies: [Buffer.from([255, 254, 24])],
    })
  })

  it('accepts server-side echo required for interactive terminal input', () => {
    const decoder = new TelnetStreamDecoder()

    expect(decoder.decode(Buffer.from([255, 251, 1]))).toEqual({
      text: '',
      replies: [Buffer.from([255, 253, 1])],
    })
  })

  it('removes subnegotiation data from the displayed output', () => {
    const decoder = new TelnetStreamDecoder()

    expect(decoder.decode(Buffer.from([65, 255, 250, 24, 1, 255, 240, 66]))).toEqual({
      text: 'AB',
      replies: [],
    })
  })
})
