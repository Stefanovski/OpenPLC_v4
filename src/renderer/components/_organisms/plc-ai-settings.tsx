import { updatePlcAiSettings, usePlcAiSettings } from '../../operations/ai-settings'

export function PlcAiSettings({ projectPath, disabled = false }: { projectPath: string; disabled?: boolean }) {
  const settings = usePlcAiSettings(projectPath)
  const { includeContext, includeDebugger, activeDebugger, proposeChanges, directEdits } = settings
  return (
    <div className='space-y-2 text-xs'>
      <p className='font-semibold'>Shared AI settings · Codex and MCP</p>
      {(
        [
          ['includeContext', 'Include current project and IO context', includeContext],
          ['activeDebugger', 'Enable active debugger commands', includeContext && activeDebugger],
          ['includeDebugger', 'Include debugger observations (read-only)', includeContext && includeDebugger],
          ['proposeChanges', 'Enable ST / C++ editing', includeContext && proposeChanges],
        ] as const
      ).map(([key, label, checked]) => (
        <label key={key} className='flex items-center gap-2'>
          <input
            type='checkbox'
            checked={checked}
            disabled={disabled || (key !== 'includeContext' && !includeContext)}
            onChange={(event) =>
              updatePlcAiSettings(projectPath, {
                [key]: event.target.checked,
                ...(key === 'includeContext' && !event.target.checked ? { includeDebugger: false } : {}),
              })
            }
            className='accent-brand'
          />
          {label}
        </label>
      ))}
      <label className='block'>
        Code changes
        <select
          aria-label='Code changes'
          value={directEdits ? 'direct' : 'review'}
          disabled={disabled || !includeContext || !proposeChanges}
          onChange={(event) => updatePlcAiSettings(projectPath, { directEdits: event.target.value === 'direct' })}
          className='mt-1 block w-full rounded border bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900'
        >
          <option value='direct'>Apply requested changes directly</option>
          <option value='review'>Review changes first</option>
        </select>
      </label>
      <p className='text-neutral-800 dark:text-neutral-400'>
        {includeContext && proposeChanges && directEdits
          ? 'Requested edits are applied to unsaved editor buffers after validation. Undo remains available until another edit or save. No automatic save or PLC download.'
          : 'Changes require review and Apply. Project context and editing must be enabled to create or change code.'}
      </p>
      {includeContext && includeDebugger && (
        <p className='text-neutral-800 dark:text-neutral-400'>
          Shares sampled watch values, IEC status and call stack when available. Samples older than 5 seconds are stale.
        </p>
      )}
    </div>
  )
}
