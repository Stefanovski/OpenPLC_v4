import { defaultDeviceConfiguration } from '@root/renderer/store/slices/device/data'

import { deviceConfigurationSchema } from './devices/configuration'
import { compareIoModule, decodeIoModule, ioChannels, ioLayoutSchema } from './io-inventory'

it('decodes physical slot 2 DIO and little-word-order model ident', () => {
  expect(decodeIoModule(2, [1, 32, 0, 1, 1, 1])).toEqual({
    slot: 2,
    version: 1,
    ident: 32,
    registerCount: 1,
    type: 1,
    communicationOk: true,
  })
  expect(decodeIoModule(1, [1, 0x5678, 0x1234, 1, 1, 4]).ident).toBe(0x12345678)
  expect(() => decodeIoModule(1, [2, 32, 0, 1, 1, 1])).toThrow()
  expect(() => decodeIoModule(1, [0, 0, 0, 1, 0, 0])).toThrow()
})
it('distinguishes communication loss, missing, additional, changed and stale modules', () => {
  const dio = decodeIoModule(2, [1, 32, 0, 1, 1, 1])
  const empty = decodeIoModule(2, [0, 0, 0, 0, 0, 0])
  expect(compareIoModule(dio, dio, true)).toBe('Match')
  expect(compareIoModule(dio, { ...dio, communicationOk: false }, true)).toBe('Communication lost')
  expect(compareIoModule(dio, empty, true)).toBe('Module missing')
  expect(compareIoModule(empty, dio, true)).toBe('Additional module')
  expect(compareIoModule(dio, { ...dio, ident: 33 }, true)).toBe('Different module')
  expect(compareIoModule(dio, dio, false)).toBe('Not verified')
  expect(compareIoModule(undefined, dio, true)).toBe('Not configured')
})
it('maps physical channel 1 to IEC bit 0 and keeps analog words unscaled', () => {
  expect(ioChannels(2, 1)[0]).toEqual({ channel: 1, input: '%IX120.0', output: '%QX120.0' })
  expect(ioChannels(7, 1)[7].output).toBe('%QX220.7')
  expect(ioChannels(2, 2)[3]).toEqual({ channel: 4, input: '%IW1103' })
  expect(ioChannels(2, 3)[3].output).toBe('%QW1103')
  expect(ioChannels(2, 9)).toEqual([])
})
it('retains optional expected inventory through configuration serialization and accepts old projects', () => {
  const ioLayout = Array.from({ length: 7 }, (_, i) => ({ slot: i + 1, type: 0, ident: 0, registerCount: 0 }))
  const config = { ...defaultDeviceConfiguration, ioLayout }
  expect(deviceConfigurationSchema.parse(JSON.parse(JSON.stringify(config))).ioLayout).toEqual(ioLayout)
  expect(deviceConfigurationSchema.parse(defaultDeviceConfiguration).ioLayout).toBeUndefined()
  expect(() => ioLayoutSchema.parse([...ioLayout.slice(0, 6), ioLayout[0]])).toThrow()
})
