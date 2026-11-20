/* eslint-disable @typescript-eslint/unbound-method -- methods in this test are Jest mocks */
import type { PrintRequest } from '@root/types/IPC/print'
import { BrowserWindow,dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { PDFDocument } from 'pdf-lib'

import { PrintService, validatePrintRequest } from './print-service'

const mockDestroy = jest.fn()
const mockPrint = jest.fn((_options: unknown, callback: (success: boolean, reason: string) => void) =>
  callback(true, ''),
)
const mockLoad = jest.fn(() => Promise.resolve())
jest.mock('electron', () => ({
  dialog: { showSaveDialog: jest.fn() },
  BrowserWindow: jest.fn(() => ({
    loadURL: mockLoad,
    destroy: mockDestroy,
    webContents: {
      setWindowOpenHandler: jest.fn(),
      executeJavaScript: jest.fn(() => Promise.resolve(true)),
      print: mockPrint,
    },
  })),
}))
jest.mock('fs/promises', () => ({ writeFile: jest.fn() }))
const request = (): PrintRequest => ({
  projectName: '<script>unsafe</script> & Grüße',
  page: { size: 'a4', orientation: 'portrait', marginsPt: { top: 36, bottom: 36, left: 36, right: 36 } },
  mode: 'normal',
  pagePolicy: 'new-page-per-pou',
  pous: [
    {
      name: 'CppBlink',
      kind: 'cpp',
      variables: [],
      lines: [{ runs: [{ text: 'Lamp = !Lamp; // ÄÖÜ <script>bad()</script>', color: '#000000' }] }],
    },
  ],
})
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(writeFile).mockResolvedValue(undefined)
  mockLoad.mockResolvedValue(undefined)
})

it('generates a PDF with real embedded fonts and escapes project text in preview', async () => {
  const service = new PrintService(null)
  const result = await service.preview(request())
  expect(result.success).toBe(true)
  expect(result.html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
  expect(result.html).not.toContain('<script>')
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'copy.pdf' })
  expect((await service.exportPdf()).success).toBe(true)
  const bytes = jest.mocked(writeFile).mock.calls[0][1]
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected PDF bytes')
  expect(bytes).toEqual(result.pdf) // Preview and export must use the exact same PDF.
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
})

it('never writes on cancellation or on a non-PDF destination', async () => {
  const service = new PrintService(null)
  await service.preview(request())
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
  expect(await service.exportPdf()).toMatchObject({ canceled: true })
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'project.json' })
  expect((await service.exportPdf()).success).toBe(false)
  expect(writeFile).not.toHaveBeenCalled()
})

it('handles disk failure without altering the cached preview', async () => {
  const service = new PrintService(null)
  await service.preview(request())
  jest.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'copy.pdf' })
  jest.mocked(writeFile).mockRejectedValueOnce(new Error('disk full'))
  expect(await service.exportPdf()).toMatchObject({ success: false, error: 'disk full' })
  expect((await service.exportPdf()).success).toBe(true)
})

it('uses a sandboxed native print window with an explicit dialog and destroys it', async () => {
  const service = new PrintService(null)
  await service.preview(request())
  expect((await service.print()).success).toBe(true)
  expect(BrowserWindow).toHaveBeenCalledWith(
    expect.objectContaining({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    }),
  )
  expect(mockPrint.mock.calls[0][0]).toMatchObject({ silent: false, pageSize: 'A4' })
  expect(mockDestroy).toHaveBeenCalledTimes(1)
})

it('cleans up the print window on load failure', async () => {
  const service = new PrintService(null)
  await service.preview(request())
  mockLoad.mockRejectedValueOnce(new Error('load failed'))
  expect((await service.print()).success).toBe(false)
  expect(mockDestroy).toHaveBeenCalledTimes(1)
  expect(mockPrint).not.toHaveBeenCalled()
})

it('refuses empty selections and invalid page settings without hanging or writing', async () => {
  const service = new PrintService(null)
  expect((await service.preview({ ...request(), pous: [] })).success).toBe(false)
  expect((await service.exportPdf()).success).toBe(false)
  const invalid = request()
  invalid.page.marginsPt.top = Infinity
  expect(() => validatePrintRequest(invalid)).toThrow()
  expect(writeFile).not.toHaveBeenCalled()
})
