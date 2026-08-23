import { useOpenPLCStore } from '@root/renderer/store'
import { getGraphicalDebugSample } from '@root/renderer/utils/graphical-debug'
import { cn } from '@root/utils'

type DebugValueBadgeProps = {
  compositeKey: string
  variableType: string | undefined
  position?: 'right' | 'left' | 'below'
}

/** Displays the current value of a non-BOOL variable while debugging a graphical POU. */
const DebugValueBadge = ({ compositeKey, variableType, position = 'right' }: DebugValueBadgeProps) => {
  const {
    workspace: { debugVariableValues, debugVariableUpdatedAt },
  } = useOpenPLCStore()

  if (!variableType || variableType.toUpperCase() === 'BOOL') return null

  const sample = getGraphicalDebugSample(debugVariableValues, debugVariableUpdatedAt, compositeKey)
  const value = sample.value
  if (value === undefined) return null

  const positionClasses: Record<NonNullable<DebugValueBadgeProps['position']>, string> = {
    right: 'left-full ml-1 top-1/2 -translate-y-1/2',
    left: 'right-full mr-1 top-1/2 -translate-y-1/2',
    below: 'top-full mt-0.5 left-1/2 -translate-x-1/2',
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute z-20 flex items-center whitespace-nowrap rounded px-1.5 py-0.5',
        'text-[10px] font-semibold leading-tight text-white',
        sample.quality === 'sampled' && 'bg-[#2E7D32] dark:bg-[#388E3C]',
        sample.quality === 'stale' && 'border border-amber-400 bg-amber-700',
        sample.quality === 'type-error' && 'border border-red-400 bg-red-800',
        positionClasses[position],
      )}
      title={
        sample.quality === 'sampled'
          ? 'Live sampled value'
          : sample.quality === 'stale'
            ? 'Stale debug value'
            : 'The target value could not be decoded'
      }
    >
      {sample.quality === 'stale' ? `${value} (stale)` : value}
    </div>
  )
}

export { DebugValueBadge }
export type { DebugValueBadgeProps }
