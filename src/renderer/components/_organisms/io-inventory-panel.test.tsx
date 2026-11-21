/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { IoInventoryPanel } from './io-inventory-panel'

const mockSetLayout = jest.fn()
const mockState = {
  project: {
    meta: { path: '/unsaved-project' },
    data: { configuration: { resource: { globalVariables: [] } }, pous: [] },
  },
  deviceDefinitions: { configuration: { deviceBoard: 'Eurosonic_Gen2_8KW', runtimeIpAddress: '192.168.200.159' } },
  deviceActions: { setIoLayout: mockSetLayout },
  editors: [],
  editor: { meta: { name: 'unsaved' } },
}
jest.mock('@root/renderer/store', () => ({
  useOpenPLCStore: (select: (state: typeof mockState) => unknown) => select(mockState),
  openPLCStoreBase: { getState: () => mockState },
}))
jest.mock('@root/renderer/components/_molecules/modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
  ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
jest.mock('@root/renderer/utils/io-observation', () => ({
  beginIoObservation: () => 1,
  cancelIoObservation: jest.fn(),
  clearIoObservation: jest.fn(),
  finishIoObservation: jest.fn(),
  getIoObservation: () => undefined,
}))
const read = jest.fn()
const rescan = jest.fn()
const inventory = () => ({
  host: '192.168.200.159',
  readAt: Date.now(),
  verified: true,
  modules: Array.from({ length: 7 }, (_, i) => ({
    slot: i + 1,
    type: i === 1 ? 1 : 0,
    ident: i === 1 ? 32 : 0,
    registerCount: i === 1 ? 1 : 0,
    version: i === 1 ? 1 : 0,
    communicationOk: i === 1,
  })),
})
beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(window, 'bridge', {
    configurable: true,
    value: { readIoInventory: read, rescanIoHardware: rescan },
  })
  read.mockResolvedValue({ success: true, inventory: inventory() })
  rescan.mockResolvedValue({ success: true, inventory: inventory(), addedSlots: [2], plcOnlySlots: [2] })
})
it('offers one hardware button; opening and cancelling never sends a command', () => {
  render(<IoInventoryPanel />)
  expect(screen.queryByText('Scan and activate…')).toBeNull()
  fireEvent.click(screen.getByText('Read hardware…'))
  expect(screen.getByRole('dialog').textContent).toContain('current PLC output values')
  fireEvent.click(screen.getByText('Cancel'))
  expect(read).not.toHaveBeenCalled()
  expect(rescan).not.toHaveBeenCalled()
  expect(mockSetLayout).not.toHaveBeenCalled()
})
it('keeps reading separate from activation and preserves project state', async () => {
  const before = JSON.stringify(mockState)
  render(<IoInventoryPanel />)
  fireEvent.click(screen.getByText('Read hardware…'))
  fireEvent.click(screen.getByText('Read inventory only'))
  await waitFor(() => expect(read).toHaveBeenCalledWith('192.168.200.159'))
  await screen.findByText(/verified inventory format/)
  expect(rescan).not.toHaveBeenCalled()
  expect(mockSetLayout).not.toHaveBeenCalled()
  expect(JSON.stringify(mockState)).toBe(before)
})
it('activates only after explicit selection and displays the PLC-only slots', async () => {
  render(<IoInventoryPanel />)
  fireEvent.click(screen.getByText('Read hardware…'))
  fireEvent.click(screen.getByText('Scan and activate'))
  await screen.findByText(/Activated slots: 2/)
  expect(rescan).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  expect(mockSetLayout).not.toHaveBeenCalled()
  expect(screen.getByText(/Activated slots/).textContent).toContain('requires a generator restart')
})
it('blocks overlapping actions and invalidates an old snapshot on activation failure', async () => {
  render(<IoInventoryPanel />)
  fireEvent.click(screen.getByText('Read hardware…'))
  fireEvent.click(screen.getByText('Read inventory only'))
  await screen.findByText(/verified inventory format/)
  let finish!: (value: unknown) => void
  rescan.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  fireEvent.click(screen.getByText('Read hardware…'))
  fireEvent.click(screen.getByText('Scan and activate'))
  expect(screen.getByText('Reading…').hasAttribute('disabled')).toBe(true)
  expect(screen.getByLabelText('IO generator IP').hasAttribute('disabled')).toBe(true)
  await act(async () => {
    finish({ success: false, error: 'No scan support' })
    await Promise.resolve()
  })
  await screen.findByText(/No scan support/)
  expect(screen.getByText('Use detected layout…').hasAttribute('disabled')).toBe(true)
  expect(mockSetLayout).not.toHaveBeenCalled()
})
