export const EUROSONIC_PLC_FLASH_SIZE_BYTES = 256 * 1024
export const EUROSONIC_PLC_HEADER_SIZE_BYTES = 1024
export const EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES = EUROSONIC_PLC_FLASH_SIZE_BYTES - EUROSONIC_PLC_HEADER_SIZE_BYTES

const EUROSONIC_PLC_HEADER_MAGIC = 0xcafebabe
const HEADER_MAGIC_OFFSET = 8
const PAYLOAD_LENGTH_OFFSET = 12

export type EurosonicPlcBinaryValidation =
  | { valid: true; fileSize: number; payloadSize: number }
  | { valid: false; fileSize: number; reason: string }

export const validateEurosonicPlcBinary = (binary: Buffer): EurosonicPlcBinaryValidation => {
  const fileSize = binary.length

  if (fileSize > EUROSONIC_PLC_FLASH_SIZE_BYTES) {
    return {
      valid: false,
      fileSize,
      reason: `file size ${fileSize} bytes exceeds the ${EUROSONIC_PLC_FLASH_SIZE_BYTES}-byte PLC flash area`,
    }
  }

  if (fileSize < EUROSONIC_PLC_HEADER_SIZE_BYTES) {
    return {
      valid: false,
      fileSize,
      reason: `file size ${fileSize} bytes is smaller than the ${EUROSONIC_PLC_HEADER_SIZE_BYTES}-byte PLC header`,
    }
  }

  if (binary.readUInt32LE(HEADER_MAGIC_OFFSET) !== EUROSONIC_PLC_HEADER_MAGIC) {
    return {
      valid: false,
      fileSize,
      reason: 'the PLC header magic is invalid',
    }
  }

  const payloadSize = binary.readUInt32LE(PAYLOAD_LENGTH_OFFSET)
  if (payloadSize > EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES) {
    return {
      valid: false,
      fileSize,
      reason: `header payload length ${payloadSize} bytes exceeds the ${EUROSONIC_PLC_MAX_PAYLOAD_SIZE_BYTES}-byte payload limit`,
    }
  }

  const expectedFileSize = EUROSONIC_PLC_HEADER_SIZE_BYTES + payloadSize
  if (fileSize !== expectedFileSize) {
    return {
      valid: false,
      fileSize,
      reason: `file size ${fileSize} bytes does not match the ${expectedFileSize} bytes declared by the PLC header`,
    }
  }

  return { valid: true, fileSize, payloadSize }
}
