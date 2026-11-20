import fontkit, { Font } from '@pdf-lib/fontkit'

import { getEmbeddedFontSet } from './fonts/embedded-font-set'
import type { PrintFontKey } from './types'

const fonts = new Map<PrintFontKey, Font>()
export function measureText(text: string, size: number, key: PrintFontKey = 'sans'): number {
  let font = fonts.get(key)
  if (!font) {
    font = fontkit.create(getEmbeddedFontSet()[key])
    fonts.set(key, font)
  }
  // Summed advances are conservative where kerning would reduce the width.
  return (
    (Array.from(text).reduce((width, char) => width + font.glyphForCodePoint(char.codePointAt(0)!).advanceWidth, 0) *
      size) /
    font.unitsPerEm
  )
}

export function wrapCell(text: string, width: number, size: number): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const result: string[] = []
    let current = ''
    for (const char of line) {
      if (current && measureText(current + char, size) > width) {
        result.push(current)
        current = ''
      }
      current += char
    }
    result.push(current)
    return result
  })
}
