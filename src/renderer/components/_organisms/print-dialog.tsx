// Adapted from OpenPLC Editor v4.3.0 export-pdf-modal.tsx; see utils/print/UPSTREAM-LICENSE.txt.
import { openPLCStoreBase } from '@root/renderer/store'
import { buildPrintRequest, defaultPrintPage, PrintSelection } from '@root/renderer/utils/print-request'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

import { Modal, ModalContent, ModalTitle } from '../_molecules/modal'
import { PdfPreviewViewer } from './pdf-preview-viewer'
import { PageSetupFields } from './print-page-setup'

const CHECKBOX = 'h-4 w-4 cursor-pointer rounded border-neutral-300 accent-brand dark:border-neutral-600'
const PRIMARY =
  'rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
const SECONDARY =
  'rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
type Choice = { name: string; type: string; language: string }
type Step = 'select' | 'options' | 'preview'

export function PrintDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('select')
  const [names, setNames] = useState<string[]>([])
  const [available, setAvailable] = useState<Choice[]>([])
  const [page, setPage] = useState(defaultPrintPage)
  const [mode, setMode] = useState<PrintSelection['mode']>('normal')
  const [pagePolicy, setPagePolicy] = useState<PrintSelection['pagePolicy']>('new-page-per-pou')
  const [configuration, setConfiguration] = useState(true)
  const [preview, setPreview] = useState<Uint8Array>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const show = () => {
      flushSync(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      const state = openPLCStoreBase.getState()
      if (!state.project.meta.path) return
      const choices = state.project.data.pous
        .map((p) => ({ name: p.data.name, type: p.type, language: p.data.body.language }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setAvailable(choices)
      setNames(choices.filter((p) => p.language !== 'sfc').map((p) => p.name))
      setPreview(undefined)
      setMessage('')
      setStep('select')
      setOpen(true)
    }
    window.addEventListener('open-print-preview', show)
    const unsubscribe = window.bridge.onPrintRequest(show)
    return () => {
      window.removeEventListener('open-print-preview', show)
      unsubscribe()
    }
  }, [])
  const close = () => {
    if (!busy) {
      setOpen(false)
      setPreview(undefined)
    }
  }
  const generate = async () => {
    setStep('preview')
    setBusy(true)
    setPreview(undefined)
    setMessage('Rendering preview…')
    try {
      const result = await window.bridge.previewPrint(
        buildPrintRequest(openPLCStoreBase.getState(), {
          names,
          includeConfiguration: configuration,
          page,
          mode,
          pagePolicy,
        }),
      )
      if (!result.success || !result.pdf) throw new Error(result.error || 'Could not create preview.')
      setPreview(new Uint8Array(result.pdf))
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const output = async (kind: 'pdf' | 'printer') => {
    setBusy(true)
    setMessage('')
    try {
      const result = kind === 'pdf' ? await window.bridge.exportPrintPdf() : await window.bridge.printDocument()
      if (result.success) setMessage(kind === 'pdf' ? 'PDF exported.' : 'Document sent to printer.')
      else if (!('canceled' in result && result.canceled)) setMessage(result.error || 'The operation was canceled.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const printable = available.filter((p) => p.language !== 'sfc')
  const allSelected = printable.length > 0 && names.length === printable.length
  return (
    <Modal
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <ModalContent
        className='flex h-[92vh] w-[92vw] select-none flex-col overflow-hidden rounded-lg p-6'
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <ModalTitle className='mb-4 shrink-0 text-xl font-semibold'>Export to PDF</ModalTitle>
        {step === 'select' && (
          <div className='flex min-h-0 flex-1 flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <label className='flex items-center gap-2 text-sm font-medium text-neutral-850 dark:text-neutral-300'>
                <input
                  type='checkbox'
                  className={CHECKBOX}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = names.length > 0 && !allSelected
                  }}
                  onChange={() => setNames(allSelected ? [] : printable.map((p) => p.name))}
                />
                Select all
              </label>
              <span className='text-sm text-neutral-600 dark:text-neutral-400'>
                {names.length} of {printable.length} selected
              </span>
            </div>
            <div className='min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {(['function', 'function-block', 'program'] as const).map((type, index) => {
                const choices = printable.filter((p) => p.type === type)
                return (
                  choices.length > 0 && (
                    <div key={type}>
                      <p className='bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase text-neutral-500 dark:bg-neutral-950 dark:text-neutral-500'>
                        {['Functions', 'Function Blocks', 'Programs'][index]}
                      </p>
                      <ul className='divide-y divide-neutral-200 dark:divide-neutral-800'>
                        {choices.map((p) => (
                          <li key={p.name} className='px-3 py-2'>
                            <label className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
                              <input
                                type='checkbox'
                                className={CHECKBOX}
                                checked={names.includes(p.name)}
                                onChange={() =>
                                  setNames(
                                    names.includes(p.name) ? names.filter((n) => n !== p.name) : [...names, p.name],
                                  )
                                }
                              />
                              {p.name}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                )
              })}
              {!printable.length && <p className='p-4 text-sm text-neutral-500'>No printable POUs in this project.</p>}
            </div>
            <label className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
              <input
                type='checkbox'
                className={CHECKBOX}
                checked={configuration}
                onChange={(e) => setConfiguration(e.target.checked)}
              />
              Include configuration (globals, tasks and data types)
            </label>
            {available.some((p) => p.language === 'sfc') && (
              <p className='text-sm text-neutral-500'>SFC POUs are not supported for printing.</p>
            )}
          </div>
        )}
        {step === 'options' && (
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-auto'>
            <fieldset className='flex flex-col gap-1'>
              <legend className='text-sm font-medium text-neutral-850 dark:text-neutral-300'>Page sharing</legend>
              {(['new-page-per-pou', 'may-share-page'] as const).map((policy, i) => (
                <label key={policy} className='flex items-center gap-2 text-sm text-neutral-850 dark:text-neutral-300'>
                  <input
                    type='radio'
                    name='print-page-policy'
                    checked={pagePolicy === policy}
                    onChange={() => setPagePolicy(policy)}
                  />
                  {['Start each POU on a new page', 'Let short POUs share a page'][i]}
                </label>
              ))}
            </fieldset>
            <PageSetupFields pageSetup={page} renderMode={mode} onPage={setPage} onMode={setMode} />
          </div>
        )}
        {step === 'preview' && (
          <div className='flex min-h-0 flex-1 flex-col gap-2'>
            {preview && <PdfPreviewViewer bytes={preview} orientation={page.orientation} />}
          </div>
        )}
        <p role='status' className='shrink-0 text-sm text-neutral-600 dark:text-neutral-400'>
          {message}
        </p>
        <div className='mt-4 flex shrink-0 items-center justify-between gap-3'>
          <div className='flex gap-3'>
            <button className={SECONDARY} disabled={busy} onClick={close}>
              Cancel
            </button>
            {step !== 'select' && (
              <button
                className={SECONDARY}
                disabled={busy}
                onClick={() => {
                  setPreview(undefined)
                  setMessage('')
                  setStep(step === 'preview' ? 'options' : 'select')
                }}
              >
                Back
              </button>
            )}
          </div>
          <div className='flex gap-3'>
            {step === 'select' && (
              <button className={PRIMARY} disabled={!names.length && !configuration} onClick={() => setStep('options')}>
                Next
              </button>
            )}
            {step === 'options' && (
              <button className={PRIMARY} onClick={() => void generate()}>
                Next
              </button>
            )}
            {step === 'preview' && (
              <>
                <button className={SECONDARY} disabled={busy || !preview} onClick={() => void output('printer')}>
                  Print…
                </button>
                <button className={PRIMARY} disabled={busy || !preview} onClick={() => void output('pdf')}>
                  Export
                </button>
              </>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
