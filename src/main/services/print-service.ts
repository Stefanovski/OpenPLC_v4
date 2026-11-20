import type { PrintRequest } from '@root/types/IPC/print'
import { getEmbeddedFontSet } from '@root/utils/print/fonts/embedded-font-set'
import { resolvePageBox } from '@root/utils/print/geometry'
import { pagesToHtml } from '@root/utils/print/html'
import { paginate } from '@root/utils/print/paginate'
import { createPdfLibBackend, drawPages } from '@root/utils/print/pdf-writer'
import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { extname } from 'path'
import { z } from 'zod'

const pageSchema = z.object({
  size: z.enum(['a4', 'a3', 'letter', 'legal']),
  orientation: z.enum(['portrait', 'landscape']),
  marginsPt: z.object({
    top: z.number().finite().min(0).max(144),
    right: z.number().finite().min(0).max(144),
    bottom: z.number().finite().min(0).max(144),
    left: z.number().finite().min(0).max(144),
  }),
})

export function validatePrintRequest(request: PrintRequest): void {
  pageSchema.parse(request.page)
  z.enum(['normal', 'scale-to-fit']).parse(request.mode)
  z.enum(['new-page-per-pou', 'may-share-page']).parse(request.pagePolicy)
  const box = resolvePageBox(request.page)
  if (box.contentWidthPt < 150 || box.contentHeightPt < 150) throw new Error('The printable page area is too small.')
  if (!Array.isArray(request.pous) || !request.pous.length) throw new Error('Select at least one POU.')
  if (JSON.stringify(request).length > 16_000_000)
    throw new Error('The print selection is too large. Export fewer POUs at a time.')
  const textSize = request.pous.reduce(
    (total, pou) =>
      total +
      JSON.stringify(pou.variables).length +
      JSON.stringify(pou.declarations ?? []).length +
      ('lines' in pou ? JSON.stringify(pou.lines).length : 0) +
      ('tables' in pou ? JSON.stringify(pou.tables).length : 0),
    0,
  )
  if (textSize > 1_000_000 || request.pous.length > 500)
    throw new Error('The selection contains too much text. Export fewer POUs at a time.')
  for (const pou of request.pous) {
    if (pou.kind !== 'fbd' && pou.kind !== 'ld') continue
    const nodes = pou.kind === 'fbd' ? pou.rung.nodes : pou.rungs.flatMap((rung) => rung.nodes)
    for (const node of nodes) {
      const values = [
        node.position.x,
        node.position.y,
        node.measured?.width ?? node.width ?? 100,
        node.measured?.height ?? node.height ?? 40,
      ]
      if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > 100_000))
        throw new Error('A diagram has invalid geometry.')
    }
  }
}

export class PrintService {
  private document?: { html: string; pdf: Uint8Array; name: string; page: PrintRequest['page'] }
  private busy = false
  constructor(private owner: BrowserWindow | null) {}

  async preview(request: PrintRequest) {
    if (this.busy) return { success: false, error: 'A print operation is already in progress.' }
    this.busy = true
    this.document = undefined
    try {
      validatePrintRequest(request)
      const pages = paginate(request)
      if (pages.length > 500) throw new Error('The document exceeds 500 pages. Select fewer POUs or use scale to fit.')
      const backend = await createPdfLibBackend(getEmbeddedFontSet())
      drawPages(backend, pages)
      const pdf = await backend.finish()
      const html = pagesToHtml(pages, request.projectName)
      this.document = { html, pdf, name: request.projectName, page: request.page }
      return { success: true, html, pdf, pages: pages.length }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.busy = false
    }
  }

  async exportPdf() {
    const document = this.document
    if (!document || this.busy) return { success: false, error: 'Create a preview first.' }
    this.busy = true
    try {
      const target = await dialog.showSaveDialog({
        title: 'Export PDF',
        defaultPath: `${document.name.replace(/[<>:"/\\|?*]/g, '_') || 'PLC-project'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['showOverwriteConfirmation'],
      })
      if (target.canceled || !target.filePath) return { success: false, canceled: true }
      if (extname(target.filePath).toLowerCase() !== '.pdf') throw new Error('Choose a file with the .pdf extension.')
      await writeFile(target.filePath, document.pdf)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.busy = false
    }
  }

  async print() {
    const document = this.document
    if (!document || this.busy) return { success: false, error: 'Create a preview first.' }
    this.busy = true
    let window: BrowserWindow | undefined
    try {
      window = new BrowserWindow({
        show: false,
        ...(this.owner ? { parent: this.owner } : {}),
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document.html)}`)
      await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
      const contents = window.webContents
      await new Promise<void>((resolve, reject) =>
        contents.print(
          {
            silent: false,
            printBackground: true,
            margins: { marginType: 'none' },
            pageSize: ({ a4: 'A4', a3: 'A3', letter: 'Letter', legal: 'Legal' } as const)[document.page.size],
            landscape: document.page.orientation === 'landscape',
          },
          (success, reason) => (success ? resolve() : reject(new Error(reason || 'Printing canceled or failed.'))),
        ),
      )
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      window?.destroy()
      this.busy = false
    }
  }
}
