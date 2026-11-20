import type { PrintTable } from '@root/types/IPC/print'

import type { ContentBlock, DrawOp } from './types'
import { wrapCell } from './typography'

/** Page-sized table chunks with repeated section titles and column headers. */
export function renderConfigurationTables(tables: PrintTable[], width: number, height: number): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const fontSize = 8
  const lineHeight = 13
  for (const table of tables) {
    const widths = table.widths.map((f) => f * width)
    const capacity = Math.max(1, Math.floor((height - 55) / lineHeight))
    let ops: DrawOp[] = []
    let y = 0
    let used = 0
    const text = (value: string, x: number, baseline: number, bold = false) => {
      ops.push({
        kind: 'text',
        text: value,
        x,
        y: baseline,
        sizePt: fontSize,
        color: '#111827',
        font: bold ? 'sansBold' : 'sans',
        align: 'left',
      })
    }
    const begin = () => {
      ops = []
      y = 0
      used = 0
      for (const line of wrapCell(table.title, width - 8, fontSize)) {
        text(line, 0, y + 10, true)
        y += lineHeight
      }
      y += 4
      ops.push({ kind: 'rect', x: 0, y, width, height: 22, fill: '#e8edf2' })
      let x = 0
      table.columns.forEach((label, i) => {
        text(label, x + 4, y + 14, true)
        x += widths[i]
      })
      y += 22
    }
    const flush = () => blocks.push({ widthPt: width, heightPt: y, ops })
    begin()
    const rows = table.rows.length ? table.rows : [['None']]
    for (const row of rows) {
      const cells = table.columns.map((_, i) => wrapCell(row[i] ?? '', widths[i] - 8, fontSize))
      const count = Math.max(...cells.map((c) => c.length))
      for (let line = 0; line < count; line++) {
        if (used >= capacity || y + lineHeight > height) {
          flush()
          begin()
        }
        let x = 0
        cells.forEach((cell, i) => {
          text(cell[line] ?? '', x + 4, y + 10)
          x += widths[i]
        })
        y += lineHeight
        used++
      }
      ops.push({ kind: 'line', x1: 0, y1: y, x2: width, y2: y, widthPt: 0.4, color: '#cbd5e1' })
    }
    flush()
  }
  return blocks
}
