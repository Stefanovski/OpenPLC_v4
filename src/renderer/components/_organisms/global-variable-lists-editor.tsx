import { sharedSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCGlobalVariableList } from '@root/types/PLC/open-plc'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'
import { lowerGlobalVariableLists, parseGvlDeclarations } from '@root/utils/PLC/global-variable-lists'
import { useState } from 'react'

import { printType } from '../../utils/print-configuration'
import { VariablesCodeEditor } from './variables-code-editor'

export function GlobalVariableListsEditor() {
  const { project, workspace, projectActions, snapshotActions } = useOpenPLCStore()
  const dirty = sharedSelectors.useHandleFileAndWorkspaceSavedState()
  const [name, setName] = useState('GVL_IO')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const lists = project.data.globalVariableLists ?? []
  const list = lists.find((item) => item.name === selected) ?? lists[0]
  const disabled =
    workspace.isDebuggerVisible ||
    workspace.plcOperationsDebuggerActive ||
    Boolean(workspace.debuggerTargetIp) ||
    workspace.editingState === 'save-request'
  const update = (next: PLCGlobalVariableList[]) => {
    if (disabled) return
    snapshotActions.addSnapshot('resource')
    projectActions.setGlobalVariableLists(next)
    dirty('Resource')
  }
  const add = () => {
    try {
      const next = [
        ...lists,
        { name: name.trim(), documentation: '', variables: [], variablesText: 'VAR_GLOBAL\nEND_VAR' },
      ]
      // Validate names and collisions without interpreting temporarily unfinished POU bodies.
      const validation = structuredClone(project.data)
      for (const pou of validation.pous) pou.data.body = { language: 'st', value: '' }
      lowerGlobalVariableLists({ ...validation, globalVariableLists: next })
      update(next)
      setSelected(name.trim())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  let parseError = ''
  if (list?.variablesText !== undefined) {
    try {
      parseGvlDeclarations(list.variablesText, project.data)
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
    }
  }
  const field =
    'rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'
  return (
    <section aria-label='Named global variable lists' className='flex w-full flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span>Global variable lists</span>
        <div className='flex items-center gap-2'>
          <input
            aria-label='New GVL name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            className={field}
          />
          <button type='button' onClick={add} disabled={disabled} className={field}>
            Add list
          </button>
        </div>
      </div>
      {error && (
        <p role='alert' className='text-red-500'>
          {error}
        </p>
      )}
      {list && (
        <>
          <div className='flex items-center gap-3'>
            <select
              aria-label='Global variable list'
              className={field}
              value={list.name}
              onChange={(e) => {
                setSelected(e.target.value)
                setDeleting(false)
              }}
            >
              {lists.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
            <span className='text-sm'>Access: {list.name}.VariableName</span>
            <button type='button' className={field} disabled={disabled} onClick={() => setDeleting(!deleting)}>
              Remove list…
            </button>
          </div>
          {deleting && (
            <div className='flex items-center gap-3'>
              <span>Remove {list.name} and its declarations? References in programs remain.</span>
              <button
                type='button'
                className={field}
                disabled={disabled}
                onClick={() => {
                  update(lists.filter((item) => item !== list))
                  setDeleting(false)
                }}
              >
                Remove
              </button>
              <button type='button' className={field} onClick={() => setDeleting(false)}>
                Cancel
              </button>
            </div>
          )}
          <div className={`h-64 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
            <VariablesCodeEditor
              readOnly={disabled}
              shouldUseDarkMode={workspace.systemConfigs.shouldUseDarkMode}
              code={list.variablesText ?? generateIecVariablesToString(list.variables)}
              onCodeChange={(text) => {
                if (disabled) return
                let variables = list.variables
                try {
                  variables = parseGvlDeclarations(text, project.data).map((v) => ({
                    ...v,
                    debug:
                      list.variables.find((old) => old.name.toLowerCase() === v.name.toLowerCase())?.debug ?? false,
                  }))
                } catch {
                  /* Keep last valid table and the entire draft. */
                }
                update(lists.map((item) => (item === list ? { ...list, variablesText: text, variables } : item)))
              }}
            />
          </div>
          {parseError ? (
            <p role='alert' className='text-red-500'>
              {parseError} The draft is preserved; compilation is blocked.
            </p>
          ) : (
            <table className='w-full text-left text-sm'>
              <thead>
                <tr>
                  {['Name', 'Type', 'Location', 'Initial value', 'RETAIN', 'Debug'].map((title) => (
                    <th className='p-2' key={title}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.variables.map((v) => (
                  <tr key={v.name} className='border-t border-neutral-300 dark:border-neutral-700'>
                    <td className='p-2'>
                      {list.name}.{v.name}
                    </td>
                    <td>{printType(v.type)}</td>
                    <td>{v.location}</td>
                    <td>{v.initialValue}</td>
                    <td>{v.retain ? 'Yes' : ''}</td>
                    <td>
                      <input
                        type='checkbox'
                        aria-label={`Debug ${list.name}.${v.name}`}
                        checked={v.debug ?? false}
                        disabled={disabled}
                        onChange={(e) =>
                          update(
                            lists.map((item) =>
                              item === list
                                ? {
                                    ...list,
                                    variables: list.variables.map((old) =>
                                      old === v ? { ...v, debug: e.target.checked } : old,
                                    ),
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
