import {
  EUROSONIC_PLC_FLASH_SIZE_BYTES,
  EUROSONIC_PLC_HEADER_SIZE_BYTES,
  EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES,
  validateEurosonicPlcBinary,
} from './eurosonic-plc-binary'

const createBinary = (payloadSize: number, fileSize = EUROSONIC_PLC_HEADER_SIZE_BYTES + payloadSize) => {
  const binary = Buffer.alloc(fileSize)
  binary.writeUInt32LE(0xcafebabe, 8)
  binary.writeUInt32LE(payloadSize, 12)
  return binary
}

describe('Eurosonic PLC binary validation', () => {
  it('accepts a binary that exactly fills the 256 KiB PLC flash area', () => {
    expect(validateEurosonicPlcBinary(createBinary(EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES))).toEqual({
      valid: true,
      fileSize: EUROSONIC_PLC_FLASH_SIZE_BYTES,
      payloadSize: EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES,
    })
  })

  it('rejects a binary larger than the PLC flash area', () => {
    const result = validateEurosonicPlcBinary(
      createBinary(EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES, EUROSONIC_PLC_FLASH_SIZE_BYTES + 1),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain('exceeds the 262144-byte PLC flash area')
  })

  it('rejects a truncated PLC header', () => {
    const result = validateEurosonicPlcBinary(Buffer.alloc(EUROSONIC_PLC_HEADER_SIZE_BYTES - 1))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain('smaller than the 1024-byte PLC header')
  })

  it('rejects an invalid PLC header magic', () => {
    const binary = createBinary(32)
    binary.writeUInt32LE(0, 8)
    const result = validateEurosonicPlcBinary(binary)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain('header magic is invalid')
  })

  it('rejects a payload length that exceeds the available flash after the header', () => {
    const binary = createBinary(32)
    binary.writeUInt32LE(EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES + 1, 12)
    const result = validateEurosonicPlcBinary(binary)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain('exceeds the 261120-byte payload limit')
  })

  it('rejects a file whose size differs from its declared payload length', () => {
    const result = validateEurosonicPlcBinary(createBinary(32, EUROSONIC_PLC_HEADER_SIZE_BYTES + 64))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toContain('does not match')
  })
})
