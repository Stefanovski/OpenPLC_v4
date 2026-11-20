import { createStore } from 'zustand/vanilla'

import { defaultDeviceConfiguration } from './data'
import { createDeviceSlice } from './slice'
import type { DeviceSlice } from './types'

it('retains expected inventory on load and marks only device configuration dirty on adoption', () => {
  const store = createStore<DeviceSlice>()(createDeviceSlice)
  const layout = Array.from({ length: 7 }, (_, i) => ({
    slot: i + 1,
    type: i === 1 ? 1 : 0,
    ident: i === 1 ? 32 : 0,
    registerCount: i === 1 ? 1 : 0,
  }))
  store
    .getState()
    .deviceActions.setDeviceDefinitions({ configuration: { ...defaultDeviceConfiguration, ioLayout: layout } })
  expect(store.getState().deviceDefinitions.configuration.ioLayout).toEqual(layout)
  expect(store.getState().deviceUpdated.updated).toBe(false)
  store.getState().deviceActions.setIoLayout(layout.map((m) => ({ ...m, type: 0, ident: 0, registerCount: 0 })))
  expect(store.getState().deviceUpdated.updated).toBe(true)
  expect(store.getState().deviceDefinitions.configuration.ioLayout?.[1].type).toBe(0)
  store.getState().deviceActions.clearDeviceDefinitions()
  expect(store.getState().deviceDefinitions.configuration.ioLayout).toBeUndefined()
})
