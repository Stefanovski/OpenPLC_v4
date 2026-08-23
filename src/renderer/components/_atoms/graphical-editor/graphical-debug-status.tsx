import { useOpenPLCStore } from '@root/renderer/store'
import { GRAPHICAL_DEBUG_STALE_AFTER_MS } from '@root/renderer/utils/graphical-debug'
import { cn } from '@root/utils'

const GraphicalDebugStatus = () => {
  const {
    workspace: { debugVariableUpdatedAt },
  } = useOpenPLCStore()
  const now = Date.now()
  const hasFreshSample = Array.from(debugVariableUpdatedAt.values()).some(
    (updatedAt) => now - updatedAt <= GRAPHICAL_DEBUG_STALE_AFTER_MS,
  )

  return (
    <div
      className={cn(
        'pointer-events-none absolute right-2 top-2 z-30 flex items-center gap-1.5 rounded border px-2 py-1',
        'bg-neutral-950/90 text-[10px] font-medium text-neutral-100 shadow-sm',
        hasFreshSample ? 'border-green-600' : 'border-amber-500 text-amber-200',
      )}
      title='Values are sampled from existing IEC runtime variables. Graph topology and power flow are evaluated on the PC; short pulses may be missed.'
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', hasFreshSample ? 'bg-green-400' : 'bg-amber-400')} />
      {hasFreshSample ? 'Online values (sampled)' : 'Waiting for online values'}
    </div>
  )
}

export { GraphicalDebugStatus }
