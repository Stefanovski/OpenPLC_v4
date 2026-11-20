import { getEmbeddedFontSet } from './fonts/embedded-font-set'
import type { DrawOp, PdfPageContent } from './types'

export const escapeMarkup = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** The native printer and preview consume the same point-based drawing operations as the PDF. */
export function pagesToHtml(pages: PdfPageContent[], title: string): string {
  const fonts = getEmbeddedFontSet()
  const fontCss = Object.entries(fonts)
    .map(
      ([name, bytes]) =>
        `@font-face{font-family:${name};src:url(data:font/ttf;base64,${Buffer.from(bytes).toString('base64')}) format('truetype');}`,
    )
    .join('')
  const svgPages = pages
    .map((page, pageIndex) => {
      let clipIndex = 0
      const draw = (op: DrawOp): string => {
        switch (op.kind) {
          case 'text':
            return `<text x="${op.x}" y="${op.y}" font-family="${op.font}" font-size="${op.sizePt}" fill="${escapeMarkup(op.color)}" text-anchor="${op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start'}" xml:space="preserve">${escapeMarkup(op.text)}</text>`
          case 'line':
            return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${escapeMarkup(op.color)}" stroke-width="${op.widthPt}"/>`
          case 'rect':
            return `<rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}" fill="${escapeMarkup(op.fill ?? 'none')}" stroke="${escapeMarkup(op.stroke ?? 'none')}" stroke-width="${op.strokeWidthPt ?? 1}"/>`
          case 'path':
            return `<path d="${escapeMarkup(op.d)}" transform="translate(${op.x} ${op.y}) scale(${op.scale ?? 1})" fill="${escapeMarkup(op.fill ?? 'none')}" stroke="${escapeMarkup(op.stroke ?? 'none')}" stroke-width="${op.strokeWidthPt ?? 1}"/>`
          case 'clipPush': {
            const id = `clip-${pageIndex}-${clipIndex++}`
            return `<defs><clipPath id="${id}"><rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}"/></clipPath></defs><g clip-path="url(#${id})">`
          }
          case 'clipPop':
            return '</g>'
        }
      }
      return `<section class="page"><svg xmlns="http://www.w3.org/2000/svg" width="${page.widthPt}pt" height="${page.heightPt}pt" viewBox="0 0 ${page.widthPt} ${page.heightPt}">${page.ops.map(draw).join('')}</svg></section>`
    })
    .join('')
  const first = pages[0]
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><title>${escapeMarkup(title)}</title><style>${fontCss}
    @page{size:${first.widthPt}pt ${first.heightPt}pt;margin:0}*{box-sizing:border-box}body{margin:0;background:#555}.page{width:${first.widthPt}pt;height:${first.heightPt}pt;margin:16px auto;background:white;break-after:page}.page:last-child{break-after:auto}svg{display:block} @media print{body{background:white}.page{margin:0}}</style></head><body>${svgPages}</body></html>`
}
