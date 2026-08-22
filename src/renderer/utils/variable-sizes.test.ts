import { toNativeIecDebugValue } from './variable-sizes'

describe('stable IEC debug value encoding', () => {
  it('converts a network-order DINT to native STM32H7 byte order without mutating the input', () => {
    const networkOrder = new Uint8Array([0, 0, 0, 2])

    expect(Array.from(toNativeIecDebugValue(networkOrder, 6))).toEqual([2, 0, 0, 0])
    expect(Array.from(networkOrder)).toEqual([0, 0, 0, 2])
  })

  it('keeps single-byte payloads unchanged and pads STRING to its native structure size', () => {
    const booleanValue = new Uint8Array([1])
    const stringValue = new Uint8Array([2, 79, 75])

    expect(toNativeIecDebugValue(booleanValue, 1)).toBe(booleanValue)
    const nativeString = toNativeIecDebugValue(stringValue, 16)
    expect(nativeString).toHaveLength(127)
    expect(Array.from(nativeString.subarray(0, 4))).toEqual([2, 79, 75, 0])
  })
})
