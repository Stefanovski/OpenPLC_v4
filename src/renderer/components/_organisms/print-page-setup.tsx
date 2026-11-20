/**
 * Paper size, orientation, margins, and render mode — shared between the
 * standalone Page Setup modal and the export-to-PDF wizard's options step.
 * Reads/writes `print.pageSetup`/`renderMode` directly via `printActions`,
 * so it takes no props and can be dropped in either place unchanged.
 */

import type {
  PageMarginsPt as PageMargins,
  PageOrientation as Orientation,
  PaperSize,
  PrintPageSetup,
  PrintRenderMode,
} from '@root/types/IPC/print'
import type { ChangeEvent } from 'react'

const PAPER_SIZES: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'a3', label: 'A3' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]

const MARGIN_SIDES: (keyof PageMargins)[] = ['top', 'right', 'bottom', 'left']

const LABEL = 'text-sm font-medium text-neutral-850 dark:text-neutral-300'
const RADIO_LABEL = 'flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'
const FIELD_INPUT =
  'rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'

const PageSetupFields = ({
  pageSetup,
  renderMode,
  onPage,
  onMode,
}: {
  pageSetup: PrintPageSetup
  renderMode: PrintRenderMode
  onPage: (page: PrintPageSetup) => void
  onMode: (mode: PrintRenderMode) => void
}) => {
  const handleMarginChange = (side: keyof PageMargins) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (Number.isNaN(value) || value < 0) return
    onPage({ ...pageSetup, marginsPt: { ...pageSetup.marginsPt, [side]: Math.min(144, value) } })
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <label htmlFor='print-paper-size' className={LABEL}>
          Paper size
        </label>
        <select
          id='print-paper-size'
          value={pageSetup.size}
          onChange={(event) => onPage({ ...pageSetup, size: event.target.value as PaperSize })}
          className={FIELD_INPUT}
        >
          {PAPER_SIZES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Orientation</legend>
        <div className='flex gap-4'>
          {(['portrait', 'landscape'] as Orientation[]).map((orientation) => (
            <label key={orientation} className={RADIO_LABEL}>
              <input
                type='radio'
                name='print-orientation'
                checked={pageSetup.orientation === orientation}
                onChange={() => onPage({ ...pageSetup, orientation })}
              />
              {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Margins (pt)</legend>
        <div className='grid grid-cols-2 gap-2'>
          {MARGIN_SIDES.map((side) => (
            <label
              key={side}
              className='flex items-center justify-between gap-2 text-sm capitalize text-neutral-850 dark:text-neutral-300'
            >
              {side}
              <input
                type='number'
                min={0}
                value={pageSetup.marginsPt[side]}
                onChange={handleMarginChange(side)}
                className={`w-20 ${FIELD_INPUT}`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className='flex flex-col gap-1'>
        <legend className={LABEL}>Render mode</legend>
        <div className='flex gap-4'>
          <label className={RADIO_LABEL}>
            <input
              type='radio'
              name='print-render-mode'
              checked={renderMode === 'normal'}
              onChange={() => onMode('normal' satisfies PrintRenderMode)}
            />
            Normal
          </label>
          <label className={RADIO_LABEL}>
            <input
              type='radio'
              name='print-render-mode'
              checked={renderMode === 'scale-to-fit'}
              onChange={() => onMode('scale-to-fit' satisfies PrintRenderMode)}
            />
            Scale to fit
          </label>
        </div>
      </fieldset>
    </div>
  )
}

export { PageSetupFields }
