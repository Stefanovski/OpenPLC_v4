import { createStore } from 'zustand/vanilla'

import { createHistorySlice } from './slice'
import type { HistorySlice, HistorySnapshot } from './types'

// Graphical schema details are unrelated to the history stack under test.
jest.mock('../fbd', () => ({ zodFBDFlowSchema: jest.requireActual<typeof import('zod')>('zod').z.any() }))
jest.mock('../ladder', () => ({ zodLadderFlowSchema: jest.requireActual<typeof import('zod')>('zod').z.any() }))

test('redo records the current state while preserving subsequent redo entries', () => {
  const store = createStore<HistorySlice>()(createHistorySlice)
  const actions = store.getState().historyActions
  const snapshot = (name: string): HistorySnapshot => ({
    variables: [],
    body: undefined,
    globalVariableLists: [{ name, documentation: '', variables: [] }],
  })
  actions.addFutureHistory('resource', snapshot('third'))
  actions.addFutureHistory('resource', snapshot('second'))
  actions.addRedoPastHistory('resource', snapshot('first'))
  expect(actions.popFutureHistory('resource')).toEqual(snapshot('second'))
  expect(actions.popFutureHistory('resource')).toEqual(snapshot('third'))
  expect(actions.popPastHistory('resource')).toEqual(snapshot('first'))
  actions.addFutureHistory('resource', snapshot('discarded'))
  actions.addPastHistory('resource', snapshot('new edit'))
  expect(actions.popFutureHistory('resource')).toBeUndefined()
})
