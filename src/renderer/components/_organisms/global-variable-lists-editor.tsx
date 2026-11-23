import { sharedSelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { PLCGlobalVariableList } from '@root/types/PLC/open-plc'
import { parseGvlDeclarations } from '@root/utils/PLC/global-variable-lists'
import { useEffect, useRef, useState } from 'react'

import {
  duplicateGvl,
  editGvlCell,
  GvlCell,
  gvlDeclarations,
  gvlFromText,
  validateGvlLists,
} from '../../utils/gvl-editing'
import { printType } from '../../utils/print-configuration'
import { VariablesCodeEditor } from './variables-code-editor'

export function GlobalVariableListsEditor({
  selectedName,
  onSelect,
}: { selectedName?: string; onSelect?: (name: string) => void } = {}) {
  const { project, workspace, projectActions, snapshotActions } = useOpenPLCStore()
  const dirty = sharedSelectors.useHandleFileAndWorkspaceSavedState()
  const [name, setName] = useState('GVL_IO')
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [mode, setMode] = useState<'table' | 'code'>('table')
  const [notice, setNotice] = useState('')
  const [noticeList, setNoticeList] = useState('')
  const [activeCell, setActiveCell] = useState('')
  const lists = project.data.globalVariableLists ?? []
  const list = lists.find((item) => item.name === (selectedName ?? selected)) ?? lists[0]
  useEffect(() => {
    setDeleting(false)
    setError('')
  }, [list?.name])
  const select = (value: string) => {
    setSelected(value)
    onSelect?.(value)
    setDeleting(false)
    setError('')
    setNotice('')
  }
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
      validateGvlLists(project.data, next)
      update(next)
      select(name.trim())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const changeText = (text: string) => {
    if (!list || disabled || text === list.variablesText) return
    update(lists.map((item) => (item === list ? gvlFromText(list, text, project.data) : item)))
  }
  const editCell = (index: number, field: GvlCell, value: string | boolean, showCodeOnError = true) => {
    const text = editGvlCell(list, index, field, value)
    changeText(text)
    try {
      parseGvlDeclarations(text, project.data)
    } catch {
      if (showCodeOnError) setMode('code')
    }
  }
  const duplicate = () => {
    if (disabled) return
    try {
      const copy = duplicateGvl(project.data, list)
      update([...lists, copy])
      select(copy.name)
      setNoticeList(copy.name)
      setNotice(
        'List duplicated. IO addresses and debug selections in the copy are cleared; assign addresses before using it.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const addVariable = () => {
    let number = 1
    while (list.variables.some((v) => v.name.toLowerCase() === `variable${number}`)) number++
    changeText(
      `${list.variablesText ?? gvlDeclarations(list.variables)}\nVAR_GLOBAL\nVariable${number} : BOOL;\nEND_VAR`,
    )
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
      {notice && list?.name === noticeList && (
        <p role='status' className='text-sm'>
          {notice}
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
                select(e.target.value)
              }}
            >
              {lists.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
            <span className='text-sm'>Access: {list.name}.VariableName</span>
            <button type='button' className={field} disabled={disabled || Boolean(parseError)} onClick={duplicate}>
              Duplicate list
            </button>
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
          <div className='flex items-center gap-2'>
            <button type='button' className={field} aria-pressed={mode === 'table'} onClick={() => setMode('table')}>
              Table
            </button>
            <button type='button' className={field} aria-pressed={mode === 'code'} onClick={() => setMode('code')}>
              Code
            </button>
            <button type='button' className={field} disabled={disabled || Boolean(parseError)} onClick={addVariable}>
              Add variable
            </button>
          </div>
          {mode === 'code' && (
            <div className={`h-64 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
              <VariablesCodeEditor
                key={list.name}
                readOnly={disabled}
                shouldUseDarkMode={workspace.systemConfigs.shouldUseDarkMode}
                code={list.variablesText ?? gvlDeclarations(list.variables)}
                onCodeChange={changeText}
              />
            </div>
          )}
          {parseError && (
            <p role='alert' className='text-red-500'>
              {parseError} The draft is preserved; compilation is blocked. Correct the declarations in Code view.
            </p>
          )}
          {mode === 'table' && (
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-sm'>
                <thead>
                  <tr>
                    {['Name', 'Type', 'Location', 'Initial value', 'Documentation', 'RETAIN', 'Debug', ''].map(
                      (title) => (
                        <th className='p-2' key={title}>
                          {title}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {list.variables.map((v, index) => (
                    <tr key={`${list.name}.${index}`} className='border-t border-neutral-300 dark:border-neutral-700'>
                      {(['name', 'type', 'location', 'initialValue', 'documentation'] as const).map((cell) => {
                        const value = cell === 'type' ? printType(v.type) : v[cell] ?? ''
                        return (
                          <td className='p-1' key={cell}>
                            <GvlTextCell
                              className={`${field} w-full min-w-24`}
                              aria-label={`${cell} ${list.name}.${v.name}`}
                              value={value}
                              revision={list.variablesText}
                              disabled={disabled || (Boolean(parseError) && activeCell !== `${index}.${cell}`)}
                              onChange={(text) => {
                                setActiveCell(`${index}.${cell}`)
                                editCell(index, cell, text, false)
                              }}
                              onBlur={() => {
                                setActiveCell('')
                                if (parseError) setMode('code')
                              }}
                            />
                          </td>
                        )
                      })}
                      <td>
                        <input
                          type='checkbox'
                          aria-label={`Retain ${list.name}.${v.name}`}
                          checked={v.retain ?? false}
                          disabled={disabled || Boolean(parseError)}
                          onChange={(e) => editCell(index, 'retain', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type='checkbox'
                          aria-label={`Debug ${list.name}.${v.name}`}
                          checked={v.debug ?? false}
                          disabled={disabled || Boolean(parseError)}
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
                      <td>
                        <button
                          type='button'
                          className={field}
                          aria-label={`Remove ${list.name}.${v.name}`}
                          disabled={disabled || Boolean(parseError)}
                          onClick={() => changeText(gvlDeclarations(list.variables.filter((_, i) => i !== index)))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Keep incomplete cell text visible while storing every keystroke for menu/keyboard Save. */
function GvlTextCell({
  value,
  revision,
  onChange,
  onBlur,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  revision?: string
  disabled: boolean
  className: string
  'aria-label': string
}) {
  const [draft, setDraft] = useState(value)
  const emitted = useRef(false)
  useEffect(() => {
    if (!emitted.current) setDraft(value)
    emitted.current = false
  }, [value, revision])
  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => {
        emitted.current = true
        setDraft(e.target.value)
        onChange(e.target.value)
      }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
