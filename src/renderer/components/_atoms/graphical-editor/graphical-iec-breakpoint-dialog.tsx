import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules/modal'

type GraphicalIecBreakpointDialogProps = {
  open: boolean
  specification: string
  elementName?: string
  instancePath?: string
  onSpecificationChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

const GraphicalIecBreakpointDialog = ({
  open,
  specification,
  elementName,
  instancePath,
  onSpecificationChange,
  onClose,
  onSubmit,
}: GraphicalIecBreakpointDialogProps) => (
  <Modal open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
    <ModalContent className='flex h-fit min-h-0 w-[640px] select-none flex-col gap-4 rounded-lg p-6'>
      <ModalTitle className='text-lg font-semibold text-neutral-950 dark:text-white'>
        Advanced Graphical IEC Breakpoint
      </ModalTitle>
      <div className='text-sm text-neutral-600 dark:text-neutral-300'>
        Separate options with semicolons, for example:
        <div className='mt-2 rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-850'>
          instance={instancePath ?? 'MAIN.PUMP1'}; Counter&gt;=10; change=Counter; hit=100
        </div>
      </div>
      <label
        htmlFor='graphical-iec-breakpoint-specification'
        className='text-sm font-medium text-neutral-800 dark:text-neutral-100'
      >
        Breakpoint specification{elementName ? ` for ${elementName}` : ''}
      </label>
      <input
        id='graphical-iec-breakpoint-specification'
        autoFocus
        className='h-10 w-full rounded-md border border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-900 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'
        value={specification}
        onChange={(event) => onSpecificationChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <div className='flex justify-end gap-3'>
        <button
          type='button'
          className='h-9 rounded-md bg-neutral-100 px-5 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
          onClick={onClose}
        >
          Cancel
        </button>
        <button type='button' className='h-9 rounded-md bg-brand px-5 font-medium text-white' onClick={onSubmit}>
          Set Breakpoint
        </button>
      </div>
    </ModalContent>
  </Modal>
)

export { GraphicalIecBreakpointDialog }
