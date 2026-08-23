import { useOpenPLCStore } from '@root/renderer/store'
import type { IecDebugResumeMode } from '@root/types/PLC/iec-debug'
import { VscDebugContinue, VscDebugStepInto, VscDebugStepOut, VscDebugStepOver } from 'react-icons/vsc'

const IEC_DEBUG_CAP_STEP_OVER = 1 << 5
const IEC_DEBUG_CAP_STEP_OUT = 1 << 6

type GraphicalIecDebugToolbarProps = {
  isSession: boolean
  isHalted: boolean
  resume: (mode: IecDebugResumeMode) => void
}

const GraphicalIecDebugToolbar = ({ isSession, isHalted, resume }: GraphicalIecDebugToolbarProps) => {
  const {
    workspace: { iecDebugMetadata, iecDebugStatus, iecDebugCapabilities, iecDebugCallStack, iecDebugBreakpoints },
  } = useOpenPLCStore()
  if (!isSession) return null

  const currentPou = iecDebugMetadata?.pous.find((candidate) => candidate.id === iecDebugStatus?.currentPouId)
  const currentBinding = iecDebugMetadata?.graphical_bindings?.find(
    (binding) =>
      binding.pou_id === iecDebugStatus?.currentPouId &&
      binding.statement_ids.includes(iecDebugStatus?.currentStatementId ?? 0),
  )

  const buttonClassName =
    'rounded border border-neutral-300 bg-neutral-50 p-1.5 text-neutral-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'

  return (
    <div className='absolute left-2 top-2 z-40 flex h-9 items-center gap-2 rounded border border-neutral-200 bg-neutral-50/95 px-2 text-xs shadow-md backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/95'>
      <span className={isHalted ? 'font-semibold text-amber-600' : 'text-neutral-600 dark:text-neutral-300'}>
        {isHalted
          ? `HALTED · ${currentPou?.name ?? '?'} · ${currentBinding?.kind ?? 'statement'} ${currentBinding?.source_line ?? '?'}`
          : 'IEC debugger RUN'}
      </span>
      <button
        type='button'
        disabled={!isHalted}
        className='rounded bg-brand p-1.5 text-white disabled:cursor-not-allowed disabled:opacity-40'
        onClick={() => resume('continue')}
        title='Continue (F5)'
        aria-label='Continue'
      >
        <VscDebugContinue size={16} />
      </button>
      <button
        type='button'
        disabled={!isHalted}
        className={buttonClassName}
        onClick={() => resume('step-into')}
        title='Step Into (F11)'
        aria-label='Step Into'
      >
        <VscDebugStepInto size={16} />
      </button>
      <button
        type='button'
        disabled={!isHalted || (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OVER) === 0}
        className={buttonClassName}
        onClick={() => resume('step-over')}
        title='Step Over (F10)'
        aria-label='Step Over'
      >
        <VscDebugStepOver size={16} />
      </button>
      <button
        type='button'
        disabled={!isHalted || (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OUT) === 0 || iecDebugCallStack.length <= 1}
        className={buttonClassName}
        onClick={() => resume('step-out')}
        title='Step Out (Shift+F11)'
        aria-label='Step Out'
      >
        <VscDebugStepOut size={16} />
      </button>
      <span className='text-neutral-500'>
        Select element · F9 breakpoint · {iecDebugBreakpoints.size}/{iecDebugStatus?.breakpointCapacity ?? 64}
      </span>
    </div>
  )
}

export { GraphicalIecDebugToolbar }
