import './configs'

import { Editor as PrimitiveEditor } from '@monaco-editor/react'
import { Modal, ModalContent, ModalTitle } from '@process:renderer/components/_molecules/modal'
import { openPLCStoreBase, useOpenPLCStore } from '@process:renderer/store'
import { PLCVariable } from '@root/types/PLC'
import type { IecDebugBreakpoint, IecDebugResumeMode, IecDebugVariable } from '@root/types/PLC/iec-debug'
import { baseTypeSchema, type PLCPou } from '@root/types/PLC/open-plc'
import * as monaco from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  VscDebugContinue,
  VscDebugStepInto,
  VscDebugStepOut,
  VscDebugStepOver,
} from 'react-icons/vsc'

import { toast } from '../../../[app]/toast/use-toast'
import {
  arduinoApiCompletion,
  cppSignatureHelp,
  cppSnippetsCompletion,
  cppStandardLibraryCompletion,
  keywordsCompletion,
  libraryCompletion,
  snippetsSTCompletion,
  tableGlobalVariablesCompletion,
  tableVariablesCompletion,
} from './completion'
import { dataTypeCompletion } from './completion/datatype.completion'
import { fbCompletion } from './completion/fb.completion'
import {
  updateDataTypeVariablesInTokenizer,
  updateEnumValuesInTokenizer,
  updateLocalVariablesInTokenizer,
} from './configs/languages/st/st'
import { parsePouToStText } from './drag-and-drop/st'
import { cleanupPythonLSP, initPythonLSP, setupPythonLSPForEditor } from './python-lsp'

type monacoEditorProps = {
  path: string
  name: string
  language: 'il' | 'st' | 'python' | 'cpp'
}

type PouToText = {
  name: string
  language: string
  type: string
  body: string
  documentation: string
  variables: {
    name: string
    class: string
    type: { definition: string; value: string }
  }[]
}
type monacoEditorOptionsType = monaco.editor.IStandaloneEditorConstructionOptions

type SnippetController = {
  insert: (snippet: string, options?: unknown) => void
}

type BlockCommentState = false | 'paren' | 'slash'

const IEC_DEBUG_CAP_STEP_OVER = 1 << 5
const IEC_DEBUG_CAP_STEP_OUT = 1 << 6
const IEC_DEBUG_CAP_CALL_STACK = 1 << 7

const iecDebugValueSize = (type: number): number => {
  if ([1, 2, 3, 17].includes(type)) return 1
  if ([4, 5, 18].includes(type)) return 2
  if ([6, 7, 10, 19].includes(type)) return 4
  if ([8, 9, 11, 12, 13, 14, 15, 20].includes(type)) return 8
  if (type === 16) return 127
  return 0
}

const formatIecDebugValue = (variable: IecDebugVariable, bytes: number[]): string => {
  const value = Uint8Array.from(bytes)
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (variable.type_code === 1) return value[0] ? 'TRUE' : 'FALSE'
  if (variable.type_code === 2) return view.getInt8(0).toString()
  if ([3, 17].includes(variable.type_code)) return view.getUint8(0).toString()
  if (variable.type_code === 4) return view.getInt16(0, true).toString()
  if ([5, 18].includes(variable.type_code)) return view.getUint16(0, true).toString()
  if (variable.type_code === 6) return view.getInt32(0, true).toString()
  if ([7, 19].includes(variable.type_code)) return view.getUint32(0, true).toString()
  if (variable.type_code === 8) return view.getBigInt64(0, true).toString()
  if ([9, 20].includes(variable.type_code)) return view.getBigUint64(0, true).toString()
  if (variable.type_code === 10) return view.getFloat32(0, true).toString()
  if (variable.type_code === 11) return view.getFloat64(0, true).toString()
  return `0x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const encodeIecDebugLiteral = (variable: IecDebugVariable, literal: string): number[] | null => {
  const size = iecDebugValueSize(variable.type_code)
  if (size <= 0 || size > 8) return null
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  const normalized = literal.trim().toUpperCase()
  const numeric = Number(literal)
  if (variable.type_code === 1) {
    if (!['TRUE', 'FALSE', '1', '0'].includes(normalized)) return null
    view.setUint8(0, ['TRUE', '1'].includes(normalized) ? 1 : 0)
  } else if (variable.type_code >= 2 && variable.type_code <= 7) {
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null
    if (variable.type_code === 2) view.setInt8(0, numeric)
    else if ([3, 17].includes(variable.type_code)) view.setUint8(0, numeric)
    else if (variable.type_code === 4) view.setInt16(0, numeric, true)
    else if ([5, 18].includes(variable.type_code)) view.setUint16(0, numeric, true)
    else if (variable.type_code === 6) view.setInt32(0, numeric, true)
    else view.setUint32(0, numeric, true)
  } else if ([17, 18, 19].includes(variable.type_code)) {
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return null
    if (variable.type_code === 17) view.setUint8(0, numeric)
    else if (variable.type_code === 18) view.setUint16(0, numeric, true)
    else view.setUint32(0, numeric, true)
  }
  else if (variable.type_code === 8) view.setBigInt64(0, BigInt(literal), true)
  else if ([9, 20].includes(variable.type_code)) view.setBigUint64(0, BigInt(literal), true)
  else if (variable.type_code === 10) {
    if (!Number.isFinite(numeric)) return null
    view.setFloat32(0, numeric, true)
  } else if (variable.type_code === 11) {
    if (!Number.isFinite(numeric)) return null
    view.setFloat64(0, numeric, true)
  }
  else return null
  return Array.from(bytes)
}

// Replace comment regions with spaces so source column positions stay intact.
function stripLineComments(line: string, state: BlockCommentState): { stripped: string; state: BlockCommentState } {
  const chars = [...line]
  let index = 0
  let currentState = state

  while (index < chars.length) {
    if (currentState) {
      const endMarker = currentState === 'paren' ? ')' : '/'
      if (chars[index] === '*' && chars[index + 1] === endMarker) {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 2
        currentState = false
      } else {
        chars[index] = ' '
        index++
      }
      continue
    }

    if (chars[index] === '/' && chars[index + 1] === '/') {
      for (let commentIndex = index; commentIndex < chars.length; commentIndex++) chars[commentIndex] = ' '
      break
    }
    if (chars[index] === '(' && chars[index + 1] === '*') {
      chars[index] = ' '
      chars[index + 1] = ' '
      index += 2
      currentState = 'paren'
      continue
    }
    if (chars[index] === '/' && chars[index + 1] === '*') {
      chars[index] = ' '
      chars[index + 1] = ' '
      index += 2
      currentState = 'slash'
      continue
    }
    index++
  }

  return { stripped: chars.join(''), state: currentState }
}

const MonacoEditor = (props: monacoEditorProps): ReturnType<typeof PrimitiveEditor> => {
  const { language, path, name } = props
  const editorRef = useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const monacoRef = useRef<null | typeof monaco>(null)
  const focusDisposables = useRef<{ onFocus?: monaco.IDisposable; onBlur?: monaco.IDisposable }>({})
  const [editorMounted, setEditorMounted] = useState(false)
  const [modelVersion, setModelVersion] = useState(0)

  const {
    editor,
    searchQuery,
    sensitiveCase,
    regularExpression,
    workspace: {
      systemConfigs: { shouldUseDarkMode },
      isDebuggerVisible,
      debugVariableValues,
      fbSelectedInstance,
      fbDebugInstances,
      iecDebugMetadata,
      iecDebugStatus,
      iecDebugCapabilities,
      iecDebugCallStack,
      iecDebugBreakpoints,
    },
    project: {
      data: {
        pous,
        configuration: {
          resource: { globalVariables },
        },
        dataTypes,
      },
    },
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
    libraries: sliceLibraries,
    editorActions: { saveEditorViewState },
    projectActions: { updatePou, createVariable },
    sharedWorkspaceActions: { handleFileAndWorkspaceSavedState },
    workspaceActions: { setIecDebugBreakpoints },
    snapshotActions: { addSnapshot },
  } = useOpenPLCStore()

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [contentToDrop, setContentToDrop] = useState<PouToText>()
  const [newName, setNewName] = useState<string>('')
  const [advancedBreakpointOpen, setAdvancedBreakpointOpen] = useState(false)
  const [advancedBreakpointLine, setAdvancedBreakpointLine] = useState<number | null>(null)
  const [advancedBreakpointSpecification, setAdvancedBreakpointSpecification] = useState('')
  const [localText, setLocalText] = useState<string>(() => {
    const pou = openPLCStoreBase.getState().project.data.pous.find((pou) => pou.data.name === name)
    return typeof pou?.data.body.value === 'string' ? pou.data.body.value : ''
  })

  useEffect(() => {
    const pou = pous.find((p) => p.data.name === name)
    const nextText = typeof pou?.data.body.value === 'string' ? pou.data.body.value : ''
    if (nextText !== localText) {
      setLocalText(nextText)
    }
  }, [name, language, pous, localText])

  const [templatesInjected, setTemplatesInjected] = useState<Set<string>>(new Set())

  const pou = pous.find((pou) => pou.data.name === name)

  const iecDebugPou = useMemo(() => {
    if (!iecDebugMetadata || language !== 'st') return undefined
    return iecDebugMetadata.pous.find((entry) => entry.name.toUpperCase() === name.toUpperCase())
  }, [iecDebugMetadata, language, name])
  const iecDebugStatements = useMemo(
    () =>
      iecDebugPou ? iecDebugMetadata?.statements.filter((statement) => statement.pou_id === iecDebugPou.id) ?? [] : [],
    [iecDebugMetadata?.statements, iecDebugPou],
  )

  const currentIecDebugStatement = useMemo(
    () => iecDebugMetadata?.statements.find((statement) => statement.id === iecDebugStatus?.currentStatementId),
    [iecDebugMetadata?.statements, iecDebugStatus?.currentStatementId],
  )
  const currentIecDebugPou = useMemo(
    () => iecDebugMetadata?.pous.find((entry) => entry.id === iecDebugStatus?.currentPouId),
    [iecDebugMetadata?.pous, iecDebugStatus?.currentPouId],
  )
  const isIecDebugSession = isDebuggerVisible && language === 'st' && iecDebugMetadata !== null
  const isIecDebugHalted = iecDebugStatus?.state === 1
  const currentIecDebugInstance = useMemo(
    () => iecDebugMetadata?.instances.find((instance) => instance.id === iecDebugStatus?.currentInstanceId),
    [iecDebugMetadata?.instances, iecDebugStatus?.currentInstanceId],
  )
  const currentIecDebugLocals = useMemo(
    () =>
      currentIecDebugInstance
        ? iecDebugMetadata?.variables.filter((variable) => variable.instance_id === currentIecDebugInstance.id) ?? []
        : [],
    [currentIecDebugInstance, iecDebugMetadata?.variables],
  )
  const [iecDebugLocalValues, setIecDebugLocalValues] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    if (!isIecDebugHalted || currentIecDebugLocals.length === 0) {
      setIecDebugLocalValues(new Map())
      return
    }
    let active = true
    const readLocals = async () => {
      const values = new Map<number, string>()
      let offset = 0
      while (active && offset < currentIecDebugLocals.length) {
        const batch: IecDebugVariable[] = []
        let responseSize = 1
        while (offset < currentIecDebugLocals.length && batch.length < 24) {
          const variable = currentIecDebugLocals[offset]
          const size = iecDebugValueSize(variable.type_code)
          offset += 1
          if (size === 0 || responseSize + 9 + size > 245) continue
          batch.push(variable)
          responseSize += 9 + size
        }
        if (batch.length === 0) continue
        const result = await window.bridge.debuggerReadIecVariables(
          batch.map((variable) => ({ id: variable.id, type: variable.type_code })),
        )
        if (!result.success || !result.data) break
        const variablesById = new Map(batch.map((variable) => [variable.id, variable]))
        for (const entry of result.data) {
          const variable = variablesById.get(entry.id)
          if (variable) values.set(entry.id, formatIecDebugValue(variable, entry.value))
        }
      }
      if (active) setIecDebugLocalValues(values)
    }
    void readLocals()
    return () => {
      active = false
    }
  }, [currentIecDebugLocals, iecDebugStatus?.haltCount, isIecDebugHalted])

  useEffect(() => {
    if (editorRef.current && searchQuery) {
      moveToMatch(editorRef.current, searchQuery, sensitiveCase, regularExpression)
    }
  }, [searchQuery, sensitiveCase, regularExpression])

  useEffect(() => {
    if (language === 'st' && pou?.data.variables) {
      const variableNames = pou.data.variables
        .filter((variable) => variable.name && variable.name.trim() !== '')
        .map((variable) => variable.name)

      updateLocalVariablesInTokenizer(variableNames)
    }
  }, [pou?.data.variables, language])

  useEffect(() => {
    // Handle template injection when POU changes (for already mounted editors)
    if (language === 'python' && editorRef.current && pou) {
      injectPythonTemplateIfNeeded(editorRef.current, pou, name)
    }
    if (language === 'cpp' && editorRef.current && pou) {
      injectCppTemplateIfNeeded(editorRef.current, pou, name)
    }
  }, [pou])

  useEffect(() => {
    return () => {
      setTemplatesInjected((prev) => {
        const newSet = new Set(prev)
        newSet.delete(name)
        return newSet
      })

      if (language === 'python') {
        cleanupPythonLSP()
      }
    }
  }, [name, language])

  useEffect(() => {
    if (language === 'st' && dataTypes.length > 0) {
      updateDataTypeVariablesInTokenizer(dataTypes)
      updateEnumValuesInTokenizer(dataTypes)
    }
  }, [dataTypes, language])

  useEffect(() => {
    const editorInstance = editorRef.current
    if (!editorInstance) return

    const disposable = editorInstance.onDidChangeModel(() => {
      setModelVersion((version) => version + 1)
    })
    return () => disposable.dispose()
  }, [editorMounted])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: isDebuggerVisible })
  }, [isDebuggerVisible])

  useEffect(() => {
    const editorInstance = editorRef.current
    if (!editorInstance || !isIecDebugSession) return

    const breakpointLines = new Set(
      iecDebugStatements
        .filter((statement) => iecDebugBreakpoints.has(statement.id))
        .map((statement) => statement.line),
    )
    const decorations: monaco.editor.IModelDeltaDecoration[] = Array.from(breakpointLines).map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'iec-debug-breakpoint-glyph', glyphMarginHoverMessage: { value: 'Breakpoint' } },
    }))

    if (currentIecDebugStatement && currentIecDebugStatement.pou_id === iecDebugPou?.id && isIecDebugHalted) {
      decorations.push({
        range: new monaco.Range(currentIecDebugStatement.line, 1, currentIecDebugStatement.line, 1),
        options: {
          isWholeLine: true,
          className: 'iec-debug-current-line',
          glyphMarginClassName: 'iec-debug-current-glyph',
          glyphMarginHoverMessage: { value: 'Current IEC statement' },
        },
      })
      editorInstance.revealLineInCenterIfOutsideViewport(currentIecDebugStatement.line)
    }

    const collection = editorInstance.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [
    currentIecDebugStatement,
    iecDebugPou?.id,
    editorMounted,
    iecDebugBreakpoints,
    iecDebugStatements,
    isIecDebugHalted,
    isIecDebugSession,
    modelVersion,
  ])

  const statementAtLine = useCallback(
    (line: number) =>
      iecDebugStatements.filter((statement) => statement.line === line).sort((left, right) => left.column - right.column)[0],
    [iecDebugStatements],
  )

  const toggleIecBreakpoint = useCallback(
    (line: number) => {
      const statement = statementAtLine(line)
      if (!statement) return
      const enabled = !iecDebugBreakpoints.has(statement.id)
      void window.bridge.debuggerSetIecBreakpoint(statement.id, enabled).then((result) => {
        if (!result.success) {
          toast({
            title: 'Breakpoint Error',
            description: result.error ?? 'Breakpoint could not be changed.',
            variant: 'fail',
          })
          return
        }
        const next = new Set(iecDebugBreakpoints)
        if (enabled) next.add(statement.id)
        else next.delete(statement.id)
        setIecDebugBreakpoints(next)
      })
    },
    [iecDebugBreakpoints, setIecDebugBreakpoints, statementAtLine],
  )

  const applyIecBreakpointSpecification = useCallback(
    (line: number, specification: string): boolean => {
      const statement = statementAtLine(line)
      if (!statement || !iecDebugMetadata) return false

      try {
        const breakpoint: IecDebugBreakpoint = { statementId: statement.id }
        const parts = specification.split(';').map((part) => part.trim()).filter(Boolean)
        let selectedInstance: (typeof iecDebugMetadata.instances)[number] | undefined
        const instancePart = parts.find((part) => part.toLowerCase().startsWith('instance='))
        if (instancePart) {
          const requested = instancePart.slice(instancePart.indexOf('=') + 1).trim()
          selectedInstance =
            requested.toLowerCase() === 'current'
              ? currentIecDebugInstance
              : iecDebugMetadata.instances.find(
                  (candidate) =>
                    candidate.pou_id === statement.pou_id &&
                    candidate.path.toUpperCase() === requested.toUpperCase(),
                )
          if (!selectedInstance || selectedInstance.pou_id !== statement.pou_id) {
            throw new Error(`Unknown ${iecDebugPou?.name ?? 'IEC'} instance '${requested}'`)
          }
          breakpoint.instanceId = selectedInstance.id
        }
        const availableVariables = selectedInstance
          ? iecDebugMetadata.variables.filter((variable) => variable.instance_id === selectedInstance.id)
          : iecDebugMetadata.variables

        for (const part of parts) {
          if (part.toLowerCase().startsWith('instance=')) {
            continue
          }
          if (part.toLowerCase().startsWith('hit=')) {
            const hitTarget = Number(part.slice(part.indexOf('=') + 1))
            if (!Number.isInteger(hitTarget) || hitTarget <= 0) throw new Error('Hit count must be a positive integer')
            breakpoint.hitTarget = hitTarget
            continue
          }
          if (part.toLowerCase().startsWith('change=')) {
            if (!selectedInstance) throw new Error('Break on change requires an explicit instance')
            const requested = part.slice(part.indexOf('=') + 1).trim().toUpperCase()
            const variable = availableVariables.find(
              (candidate) =>
                candidate.path.toUpperCase() === requested || candidate.path.toUpperCase().endsWith(`.${requested}`),
            )
            if (!variable) throw new Error(`Unknown local IEC variable '${requested}'`)
            const size = iecDebugValueSize(variable.type_code)
            if (size <= 0 || size > 8) throw new Error(`Break on change does not support ${variable.type}`)
            breakpoint.change = { variableId: variable.id, type: variable.type_code, size }
            continue
          }

          const condition = part.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/)
          if (!condition) throw new Error(`Unknown breakpoint option '${part}'`)
          if (!selectedInstance) throw new Error('A conditional breakpoint requires an explicit instance')
          const requested = condition[1].trim().toUpperCase()
          const variable = availableVariables.find(
            (candidate) =>
              candidate.path.toUpperCase() === requested || candidate.path.toUpperCase().endsWith(`.${requested}`),
          )
          if (!variable) throw new Error(`Unknown local IEC variable '${condition[1].trim()}'`)
          const value = encodeIecDebugLiteral(variable, condition[3])
          if (!value) throw new Error(`Conditions do not support ${variable.type}`)
          breakpoint.condition = {
            variableId: variable.id,
            type: variable.type_code,
            operator: condition[2] as NonNullable<IecDebugBreakpoint['condition']>['operator'],
            value,
          }
        }

        void window.bridge.debuggerSetIecBreakpointEx(breakpoint, true).then((result) => {
          if (!result.success) {
            toast({ title: 'Breakpoint Error', description: result.error, variant: 'fail' })
            return
          }
          const next = new Set(iecDebugBreakpoints)
          next.add(statement.id)
          setIecDebugBreakpoints(next)
        })
        return true
      } catch (error) {
        toast({
          title: 'Breakpoint Error',
          description: error instanceof Error ? error.message : String(error),
          variant: 'fail',
        })
        return false
      }
    },
    [
      currentIecDebugInstance,
      currentIecDebugLocals,
      iecDebugBreakpoints,
      iecDebugMetadata,
      setIecDebugBreakpoints,
      statementAtLine,
    ],
  )

  const configureIecBreakpoint = useCallback(
    (line: number) => {
      const statement = statementAtLine(line)
      if (!statement || !iecDebugMetadata) return
      const defaultInstance =
        currentIecDebugInstance?.pou_id === statement.pou_id ? `instance=${currentIecDebugInstance.path}` : ''
      setAdvancedBreakpointLine(line)
      setAdvancedBreakpointSpecification(defaultInstance)
      setAdvancedBreakpointOpen(true)
    },
    [currentIecDebugInstance, iecDebugMetadata, statementAtLine],
  )

  const closeAdvancedBreakpointDialog = useCallback(() => {
    setAdvancedBreakpointOpen(false)
    setAdvancedBreakpointLine(null)
    setAdvancedBreakpointSpecification('')
  }, [])

  const submitAdvancedBreakpoint = useCallback(() => {
    if (advancedBreakpointLine === null) return
    if (applyIecBreakpointSpecification(advancedBreakpointLine, advancedBreakpointSpecification)) {
      closeAdvancedBreakpointDialog()
    }
  }, [
    advancedBreakpointLine,
    advancedBreakpointSpecification,
    applyIecBreakpointSpecification,
    closeAdvancedBreakpointDialog,
  ])

  useEffect(() => {
    const editorInstance = editorRef.current
    if (!editorInstance || !isIecDebugSession) return
    const disposable = editorInstance.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) return
      if (event.event.rightButton) configureIecBreakpoint(event.target.position.lineNumber)
      else toggleIecBreakpoint(event.target.position.lineNumber)
    })
    return () => disposable.dispose()
  }, [configureIecBreakpoint, editorMounted, isIecDebugSession, toggleIecBreakpoint])

  const resumeIecDebug = useCallback((mode: IecDebugResumeMode) => {
    void window.bridge.debuggerResumeIec(mode).then((result) => {
      if (!result.success) {
        toast({
          title: 'IEC Debugger Error',
          description: result.error ?? 'The PLC could not be resumed.',
          variant: 'fail',
        })
      }
    })
  }, [])

  useEffect(() => {
    if (!isIecDebugSession) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const line = editorRef.current?.getPosition()?.lineNumber
      if (event.key === 'F9' && line) {
        event.preventDefault()
        if (event.shiftKey) configureIecBreakpoint(line)
        else toggleIecBreakpoint(line)
      } else if (event.key === 'F5' && isIecDebugHalted) {
        event.preventDefault()
        resumeIecDebug('continue')
      } else if (
        event.key === 'F10' &&
        isIecDebugHalted &&
        (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OVER) !== 0
      ) {
        event.preventDefault()
        resumeIecDebug('step-over')
      } else if (event.key === 'F11' && isIecDebugHalted) {
        event.preventDefault()
        if (
          !event.shiftKey ||
          ((iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OUT) !== 0 && iecDebugCallStack.length > 1)
        ) {
          resumeIecDebug(event.shiftKey ? 'step-out' : 'step-into')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    configureIecBreakpoint,
    iecDebugCallStack.length,
    iecDebugCapabilities,
    isIecDebugHalted,
    isIecDebugSession,
    resumeIecDebug,
    toggleIecBreakpoint,
  ])

  const fbInstanceContext = useMemo(() => {
    if (!pou || pou.type !== 'function-block') return null
    const fbTypeKey = pou.data.name.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    if (!selectedKey) return null
    const instances = fbDebugInstances.get(fbTypeKey) || []
    return instances.find((instance) => instance.key === selectedKey) || null
  }, [pou, fbSelectedInstance, fbDebugInstances])

  const debugVarKeySet = useMemo(() => {
    return Array.from(debugVariableValues.keys()).sort().join('\0')
  }, [debugVariableValues])

  const debugVarPositions = useMemo(() => {
    if (!isDebuggerVisible || !editorRef.current || (language !== 'st' && language !== 'il')) return null

    const model = editorRef.current.getModel()
    if (!model) return null

    const prefix = fbInstanceContext
      ? `${fbInstanceContext.programName}:${fbInstanceContext.fbVariableName}.`
      : `${name}:`
    const variableNames = Array.from(debugVariableValues.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort((first, second) => second.length - first.length)

    if (variableNames.length === 0) return null

    const expressionPatterns = variableNames.map((expression) => {
      const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return { expression, pattern: new RegExp(`\\b${escaped}(?![\\w.\\[])`, 'gi') }
    })
    const positions: Array<{ expression: string; line: number; startColumn: number; endColumn: number }> = []
    let blockCommentState: BlockCommentState = false

    for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
      const result = stripLineComments(model.getLineContent(lineNumber), blockCommentState)
      blockCommentState = result.state
      const claimedRanges: Array<[number, number]> = []

      for (const { expression, pattern } of expressionPatterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(result.stripped)) !== null) {
          const startColumn = match.index + 1
          const endColumn = startColumn + match[0].length
          if (claimedRanges.some(([start, end]) => startColumn < end && endColumn > start)) continue
          claimedRanges.push([startColumn, endColumn])
          positions.push({ expression, line: lineNumber, startColumn, endColumn })
          break
        }
      }
    }

    return { prefix, positions }
  }, [isDebuggerVisible, debugVarKeySet, language, name, fbInstanceContext, editorMounted, modelVersion])

  useEffect(() => {
    if (!debugVarPositions || !editorRef.current) return

    const { prefix, positions } = debugVarPositions
    const decorations: monaco.editor.IModelDeltaDecoration[] = positions.map(
      ({ expression, line, startColumn, endColumn }) => ({
        range: new monaco.Range(line, startColumn, line, endColumn),
        options: {
          after: {
            content: ` = ${debugVariableValues.get(prefix + expression) ?? '?'} `,
            inlineClassName: 'debug-inline-value',
          },
        },
      }),
    )

    const collection = editorRef.current.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [debugVarPositions, debugVariableValues])

  const variablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableVariablesCompletion({
        range,
        variables: (pou?.data.variables || []) as PLCVariable[],
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [pou?.data.variables],
  )

  const globalVariablesSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = tableGlobalVariablesCompletion({
        range,
        variables: globalVariables as PLCVariable[],
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [globalVariables],
  )

  const librarySuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = libraryCompletion({
        range,
        library: sliceLibraries,
        pous,
        editor,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [sliceLibraries],
  )

  const fbSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      // Filter custom function blocks from POUs
      const customFBs = pous.filter((pou) => pou.type === 'function-block')

      const suggestions = fbCompletion({
        model,
        position,
        range,
        pouVariables: pou?.data.variables || [],
        customFBs,
        editorName: name,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [pou?.data.variables, pous],
  )

  const dataTypeSuggestions = useCallback(
    (range: monaco.IRange, model: monaco.editor.ITextModel, position: monaco.IPosition) => {
      // Use data types from project data (not from POUs)

      const suggestions = dataTypeCompletion({
        model,
        position,
        range,
        pouVariables: pou?.data.variables || [],
        customDataTypes: dataTypes,
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [dataTypes, pou?.data.variables],
  )

  const keywordsSuggestions = useCallback(
    (range: monaco.IRange) => {
      const allSuggestions = keywordsCompletion({
        range,
        language: language as 'st' | 'il',
      }).suggestions

      let filteredSuggestions = allSuggestions
      let filteredLabels = allSuggestions.map((suggestion) => suggestion.label)
      let uniqueSuggestions = allSuggestions

      if (language === 'st') {
        const stSnippetLabels = [
          'if',
          'ifelse',
          'ifelseif',
          'for',
          'while',
          'repeat',
          'case',
          'program',
          'function',
          'function_block',
          'var',
          'var_input',
          'var_output',
          'array',
          'struct',
          'comment_block',
        ]

        filteredSuggestions = allSuggestions.filter(
          (suggestion) => !stSnippetLabels.includes(suggestion.label.toLowerCase()),
        )

        uniqueSuggestions = Array.from(new Map(filteredSuggestions.map((s) => [s.label, s])).values())
        filteredLabels = uniqueSuggestions.map((suggestion) => suggestion.label)
      }

      return {
        suggestions: uniqueSuggestions,
        labels: filteredLabels,
      }
    },
    [language],
  )

  const snippetsSTSuggestions = useCallback(
    (range: monaco.IRange) => {
      const suggestions = snippetsSTCompletion({
        range,
        language: language as 'st' | 'il',
      }).suggestions
      const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())
      const labels = uniqueSuggestions.map((suggestion) => suggestion.label)
      return {
        suggestions: uniqueSuggestions,
        labels,
      }
    },
    [language],
  )

  /**
   * Update the auto-completion feature of the monaco editor.
   * Note: Python uses its own LSP-based completion provider (pyright).
   * C/C++ uses Monaco's built-in language support. A full LSP (like clangd-wasm)
   * can be added in the future when a mature web-based solution is available.
   */
  useEffect(() => {
    if (language === 'python' || language === 'cpp') {
      return
    }

    const disposable = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const dotAccessMatch = textUntilPosition.match(/(\w+)\.$/)
        if (dotAccessMatch) {
          const variableName = dotAccessMatch[1]

          const primitiveTypes: string[] = baseTypeSchema.options

          const allVariables = [...(pou?.data.variables ?? []), ...(globalVariables ?? [])]

          const variable = allVariables.find((v) => v.name === variableName)

          if (variable && primitiveTypes.includes(variable.type.value)) {
            return { suggestions: [] }
          }
        }

        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const linesContent: Array<string[]> = []
        model.getLinesContent().forEach((line) => {
          linesContent.push(line.trim().split(' '))
        })

        const identifierTokens = linesContent.flat().flatMap((token) => {
          return token.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []
        })

        const identifiers = Array.from(
          new Set(
            identifierTokens
              .map((token) => {
                if (
                  snippetsSTSuggestions(range).labels.includes(token) ||
                  variablesSuggestions(range).labels.includes(token) ||
                  globalVariablesSuggestions(range).labels.includes(token) ||
                  librarySuggestions(range).labels.includes(token) ||
                  keywordsSuggestions(range).labels.includes(token) ||
                  fbSuggestions(range, model, position).labels.includes(token) ||
                  dataTypeSuggestions(range, model, position).labels.includes(token)
                ) {
                  return null
                }
                return token
              })
              .filter((suggestion) => suggestion !== null),
          ),
        )
        const identifiersSuggestions = identifiers.map((identifier) => ({
          label: identifier,
          kind: monaco.languages.CompletionItemKind.Text,
          insertText: identifier,
          range,
        }))

        const suggestions = [
          ...fbSuggestions(range, model, position).suggestions,
          ...dataTypeSuggestions(range, model, position).suggestions,
          ...snippetsSTSuggestions(range).suggestions,
          ...variablesSuggestions(range).suggestions,
          ...globalVariablesSuggestions(range).suggestions,
          ...librarySuggestions(range).suggestions,
          ...keywordsSuggestions(range).suggestions,
          ...identifiersSuggestions,
        ]
        const uniqueSuggestions = Array.from(new Map(suggestions.map((s) => [s.label, s])).values())

        return { suggestions: uniqueSuggestions }
      },
    })
    return () => disposable.dispose()
  }, [pou?.data.variables, globalVariables, sliceLibraries, language, snippetsSTSuggestions])

  /**
   * C/C++ completion provider
   * Provides autocomplete for standard library functions and code snippets
   * Conditionally includes Arduino API functions when an Arduino board is selected
   */
  const parseCppVariables = (code: string, range: monaco.IRange): monaco.languages.CompletionItem[] => {
    const variables = new Set<string>()

    const declarationPattern =
      /\b(?:const\s+)?(?:unsigned\s+|signed\s+)?(?:int|float|double|char|bool|long|short|void|auto|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t|size_t|String)\s*\*?\s+(\w+)(?:\s*=|\s*;|\s*\[|\s*\()/g

    const paramPattern = /\(([^)]*)\)/g

    let match
    while ((match = declarationPattern.exec(code)) !== null) {
      const varName = match[1]
      if (varName && !['if', 'while', 'for', 'switch', 'return'].includes(varName)) {
        variables.add(varName)
      }
    }

    while ((match = paramPattern.exec(code)) !== null) {
      const params = match[1]
      if (params) {
        const paramList = params.split(',')
        paramList.forEach((param) => {
          const paramMatch = param.trim().match(/\b(\w+)\s*$/)
          if (paramMatch && paramMatch[1]) {
            variables.add(paramMatch[1])
          }
        })
      }
    }

    return Array.from(variables).map((varName) => ({
      label: varName,
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: 'Local variable',
      insertText: varName,
      range,
    }))
  }

  useEffect(() => {
    if (language !== 'cpp') {
      return
    }

    const completionDisposable = monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const stdLibSuggestions = cppStandardLibraryCompletion({ range }).suggestions
        const snippetSuggestions = cppSnippetsCompletion({ range }).suggestions

        const isArduinoTarget = deviceBoard && !deviceBoard.includes('OpenPLC Runtime')
        const arduinoSuggestions = isArduinoTarget ? arduinoApiCompletion({ range }).suggestions : []

        const code = model.getValue()
        const variableSuggestions = parseCppVariables(code, range)

        const suggestions: monaco.languages.CompletionItem[] = [
          ...stdLibSuggestions,
          ...snippetSuggestions,
          ...arduinoSuggestions,
          ...variableSuggestions,
        ]

        return { suggestions }
      },
    })

    const signatureHelpDisposable = monaco.languages.registerSignatureHelpProvider('cpp', cppSignatureHelp)

    return () => {
      completionDisposable.dispose()
      signatureHelpDisposable.dispose()
    }
  }, [language, deviceBoard])

  function handleEditorDidMount(
    editorInstance: null | monaco.editor.IStandaloneCodeEditor,
    monacoInstance: null | typeof monaco,
  ) {
    editorRef.current = editorInstance
    monacoRef.current = monacoInstance
    setEditorMounted(true)

    if (!editorInstance || !monacoInstance) return

    focusDisposables.current.onFocus?.dispose()
    focusDisposables.current.onBlur?.dispose()

    if (editorInstance) {
      focusDisposables.current.onFocus = editorInstance.onDidFocusEditorText(() => {
        openPLCStoreBase.getState().editorActions.setMonacoFocused(true)
      })

      focusDisposables.current.onBlur = editorInstance.onDidBlurEditorText(() => {
        openPLCStoreBase.getState().editorActions.setMonacoFocused(false)
      })
    }

    if (searchQuery) {
      moveToMatch(editorInstance, searchQuery, sensitiveCase, regularExpression)
    }

    if (editor.cursorPosition) {
      editorInstance.setPosition(editor.cursorPosition)
      editorInstance.revealPositionInCenter(editor.cursorPosition)
    }

    if (editor.scrollPosition) {
      editorInstance.setScrollTop(editor.scrollPosition.top)
      editorInstance.setScrollLeft(editor.scrollPosition.left)
    }

    if (language === 'python' && pou) {
      injectPythonTemplateIfNeeded(editorInstance, pou, name)
      initPythonLSP(monacoInstance)
        .then(() => setupPythonLSPForEditor(editorInstance))
        .catch((err: unknown) => console.warn('[Python LSP]', err instanceof Error ? err.message : err))
    }

    if (language === 'cpp' && pou) {
      injectCppTemplateIfNeeded(editorInstance, pou, name)
    }

    editorInstance.focus()
  }

  function injectPythonTemplateIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, pou: PLCPou, pouName: string) {
    const editorModel = editor.getModel()
    if (!editorModel) return

    const stateValue = pou.data.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    const shouldInjectTemplate = stateIsEmpty && !alreadyInjected

    if (shouldInjectTemplate) {
      const pythonTemplate = `# ================================================================
# DISCLAIMER: Python Function Block Execution
#
# This block runs asynchronously from the main PLC runtime.
# ---------------------------------------------------------------
# - All variables are shared with the runtime through shared memory.
# - The block_init() function is called once when the block starts.
# - The block_loop() function is called periodically (~100ms).
# - IMPORTANT: This periodic call DOES NOT follow the PLC scan cycle.
#   It is NOT guaranteed that block_loop() will execute once per scan.
#
# Use this block for non-time-critical tasks. For logic that must
# match the PLC scan cycle, use standard IEC 61131-3 function blocks.
# ================================================================

from multiprocessing import shared_memory
import struct
import time
import os

def block_init():
    print('Block was initialized')

def block_loop():
    print('Block has run the loop function')
`

      editor.setValue(pythonTemplate)
      handleWriteInPou(pythonTemplate)

      // Position cursor at the end
      const lineCount = editorModel.getLineCount()
      const lastLineContent = editorModel.getLineContent(lineCount)
      const position = {
        lineNumber: lineCount,
        column: lastLineContent.length + 1,
      }
      editor.setPosition(position)

      setTemplatesInjected((prev) => new Set(prev).add(pouName))
    }
  }

  function injectCppTemplateIfNeeded(editor: monaco.editor.IStandaloneCodeEditor, pou: PLCPou, pouName: string) {
    const editorModel = editor.getModel()
    if (!editorModel) return

    const stateValue = pou.data.body.value as string
    const stateIsEmpty = !stateValue || stateValue.trim() === ''
    const alreadyInjected = templatesInjected.has(pouName)

    const shouldInjectTemplate = stateIsEmpty && !alreadyInjected

    if (shouldInjectTemplate) {
      const cppTemplate = `/* ================================================================
 *  C/C++ FUNCTION BLOCK
 *
 *  ---------------------------------------------------------------
 *  - This function block runs **in sync** with the PLC runtime.
 *  - The \`setup()\` function is called once when the block initializes.
 *  - The \`loop()\` function is called at every PLC scan cycle.
 *  - Block input and output variables declared in the variable table
 *    can be accessed directly by name in this C/C++ code.
 *
 *  This block executes as part of the main PLC process and follows
 *  the configured scan time in the Resources. Use it for real-time
 *  control logic, fast I/O operations, or any C-based algorithms.
 * ================================================================ */

#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

// Called once when the block is initialized
void setup()
{

}

// Called at every PLC scan cycle
void loop()
{

}
`

      editor.setValue(cppTemplate)
      handleWriteInPou(cppTemplate)

      // Position cursor at the end
      const lineCount = editorModel.getLineCount()
      const lastLineContent = editorModel.getLineContent(lineCount)
      const position = {
        lineNumber: lineCount,
        column: lastLineContent.length + 1,
      }
      editor.setPosition(position)

      setTemplatesInjected((prev) => new Set(prev).add(pouName))
    }
  }

  function moveToMatch(
    editor: monaco.editor.IStandaloneCodeEditor | null,
    searchQuery: string,
    sensitiveCase: boolean,
    regularExpression: boolean,
  ) {
    if (!editor || !monacoRef.current || !searchQuery) return

    const model = editor.getModel()
    if (!model) return

    const matches = model.findMatches(searchQuery, true, regularExpression, sensitiveCase, null, true)

    if (matches && matches.length > 0) {
      const firstMatchRange = matches[0].range
      editor.setSelection(firstMatchRange)
      editor.revealRangeInCenter(firstMatchRange)
    }
  }

  function handleWriteInPou(value: string | undefined) {
    if (value === undefined) return

    setLocalText(value)
    handleFileAndWorkspaceSavedState(name)
    updatePou({ name, content: { language, value } })
  }

  const monacoEditorUserOptions: monacoEditorOptionsType = {
    minimap: {
      enabled: false,
    },
    dropIntoEditor: {
      enabled: true,
    },
    readOnly: isDebuggerVisible,
    glyphMargin: isIecDebugSession,
    // Debug halts can navigate between POU models while the editor still has keyboard focus. Monaco's
    // WordHighlighter rejects its pending delay with "Canceled" during that model switch, which the Electron
    // development overlay reports as an application error. Debug values already provide the relevant highlights.
    occurrencesHighlight: isDebuggerVisible ? 'off' : 'singleFile',
  }

  const handleDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault()
    ev.stopPropagation()

    let pouToAppend
    const pouPath = ev.dataTransfer.getData('application/library')

    const [scope, libraryName, pouName] = pouPath.split('/')

    const libraryScope = scope as 'system' | 'user'
    if (libraryScope === 'system') {
      const libraries = sliceLibraries.system
      const libraryToUse = libraries.find((library) => library.name === libraryName)
      pouToAppend = libraryToUse?.pous.find((pou) => pou.name === pouName)
    } else {
      const libraries = sliceLibraries.user
      const libraryToUse = libraries.find((library) => library.name === libraryName)
      const pou = pous.find((pou) => pou.data.name === libraryToUse?.name)
      if (!pou) return
      pouToAppend = {
        name: pou.data.name,
        type: pou.type,
        variables: pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        })),
        documentation: pou.data.documentation,
        extensible: false,
      }
    }

    setContentToDrop(pouToAppend as PouToText)

    if (pouToAppend?.type === 'function') {
      const contentToInsert = parsePouToStText(pouToAppend as PouToText)

      const snippetController = editorRef.current?.getContribution('snippetController2') as unknown as SnippetController
      if (snippetController) {
        snippetController.insert(contentToInsert)
      }
    } else {
      setIsOpen(true)
    }
  }

  function checkIfVariableExists(existingNames: string[], baseName: string): string {
    let newName = baseName
    let index = 1

    while (existingNames.includes(newName)) {
      newName = `${baseName}_${index}`
      index++
    }

    return newName
  }

  const handleRenamePou = () => {
    if (!contentToDrop || !editorRef.current) return

    addSnapshot(editor.meta.name)

    const currentEditor = pous.find((pou) => pou.data.name === editor.meta.name)
    if (!currentEditor) return

    const existingNames = currentEditor.data.variables.map((variable) => variable.name)
    const uniqueName = checkIfVariableExists(existingNames, newName)

    const renamedContent = { ...contentToDrop, name: uniqueName }
    const contentToInsert = parsePouToStText(renamedContent)

    const snippetController = editorRef.current.getContribution('snippetController2') as unknown as SnippetController
    if (snippetController) {
      snippetController.insert(contentToInsert)
    }

    setIsOpen(false)
    setNewName('')

    const res = createVariable({
      data: {
        name: uniqueName,
        type: {
          definition: 'derived',
          value: contentToDrop.name,
        },
        class: 'local',
        location: '',
        documentation: '',
        debug: false,
      },
      scope: 'local',
      associatedPou: editor.meta.name,
    })

    if (!res.ok) {
      toast({
        title: res.title,
        description: res.message,
        variant: 'fail',
      })
      return
    }
  }

  const handleCancelRenamePou = () => {
    setIsOpen(false)
    setNewName('')
  }

  useEffect(() => {
    const unsub = openPLCStoreBase.subscribe(
      (state) => state.editor.meta.name,
      (newName, prevEditorName) => {
        if (newName === prevEditorName || !editorRef.current) return

        const editor = editorRef.current
        const model = editor.getModel()
        const pos = editor.getPosition()
        const offset = pos && model?.getOffsetAt(pos)

        const cursorPosition = pos && offset ? { lineNumber: pos.lineNumber, column: pos.column, offset } : undefined

        const scrollPosition = {
          top: editor.getScrollTop(),
          left: editor.getScrollLeft(),
        }

        saveEditorViewState({ prevEditorName, cursorPosition, scrollPosition })
      },
    )

    return () => unsub()
  }, [])

  return (
    <>
      <div id='editor drop handler' className='oplc-monaco-wrapper nokey h-full w-full' onDrop={handleDrop}>
        {isIecDebugSession && (
          <div className='flex h-9 items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 text-xs dark:border-neutral-800 dark:bg-neutral-950'>
            <span
              className={isIecDebugHalted ? 'font-semibold text-amber-600' : 'text-neutral-600 dark:text-neutral-300'}
            >
              {isIecDebugHalted
                ? `HALTED · ${currentIecDebugPou?.name ?? name}${currentIecDebugInstance ? ` · ${currentIecDebugInstance.path}` : ''} · ${currentIecDebugStatement?.file ?? '?'} ${currentIecDebugStatement?.line ?? '?'}:${currentIecDebugStatement?.column ?? '?'} · ID ${currentIecDebugStatement?.id ?? '?'}`
                : 'IEC debugger RUN'}
            </span>
            <button
              type='button'
              disabled={!isIecDebugHalted}
              className='rounded bg-brand p-1.5 text-white disabled:cursor-not-allowed disabled:opacity-40'
              onClick={() => resumeIecDebug('continue')}
              title='Continue (F5)'
              aria-label='Continue'
            >
              <VscDebugContinue size={16} />
            </button>
            <button
              type='button'
              disabled={!isIecDebugHalted}
              className='rounded border border-neutral-300 p-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700'
              onClick={() => resumeIecDebug('step-into')}
              title='Step Into (F11)'
              aria-label='Step Into'
            >
              <VscDebugStepInto size={16} />
            </button>
            <button
              type='button'
              disabled={!isIecDebugHalted || (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OVER) === 0}
              className='rounded border border-neutral-300 p-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700'
              onClick={() => resumeIecDebug('step-over')}
              title='Step Over (F10)'
              aria-label='Step Over'
            >
              <VscDebugStepOver size={16} />
            </button>
            <button
              type='button'
              disabled={
                !isIecDebugHalted ||
                (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OUT) === 0 ||
                iecDebugCallStack.length <= 1
              }
              className='rounded border border-neutral-300 p-1.5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700'
              onClick={() => resumeIecDebug('step-out')}
              title='Step Out (Shift+F11)'
              aria-label='Step Out'
            >
              <VscDebugStepOut size={16} />
            </button>
            <span className='ml-auto text-neutral-500'>
              F9 breakpoint · Shift+F9 advanced · {iecDebugBreakpoints.size}/
              {iecDebugStatus?.breakpointCapacity ?? 64}
            </span>
          </div>
        )}
        <PrimitiveEditor
          options={monacoEditorUserOptions}
          height={isIecDebugSession ? `calc(100% - ${isIecDebugHalted ? 180 : 36}px)` : '100%'}
          width='100%'
          path={path}
          language={language}
          defaultValue={''}
          value={localText}
          onMount={handleEditorDidMount}
          onChange={handleWriteInPou}
          theme={shouldUseDarkMode ? 'openplc-dark' : 'openplc-light'}
          // Disabled: view state (cursor/scroll) is managed manually via Zustand store.
          // View state (cursor/scroll) is managed manually via Zustand. Keeping Monaco's built-in view-state
          // restore disabled also avoids scheduling WordHighlighter work during language switches.
          saveViewState={false}
          keepCurrentModel={true}
        />
        {isIecDebugSession && isIecDebugHalted && (
          <div className='grid h-36 grid-cols-2 border-t border-neutral-200 bg-white text-xs dark:border-neutral-800 dark:bg-neutral-900'>
            <section className='overflow-auto border-r border-neutral-200 p-2 dark:border-neutral-800'>
              <div className='mb-1 font-semibold text-neutral-700 dark:text-neutral-200'>IEC Call Stack</div>
              {(iecDebugCapabilities & IEC_DEBUG_CAP_CALL_STACK) === 0 ? (
                <div className='text-neutral-500'>Target does not provide a logical IEC call stack.</div>
              ) : (
                [...iecDebugCallStack].reverse().map((frame, index) => {
                  const framePou = iecDebugMetadata?.pous.find((candidate) => candidate.id === frame.pouId)
                  const frameInstance = iecDebugMetadata?.instances.find(
                    (candidate) => candidate.id === frame.instanceId,
                  )
                  const frameStatement = iecDebugMetadata?.statements.find(
                    (candidate) => candidate.id === frame.statementId,
                  )
                  return (
                    <div key={`${frame.pouId}:${frame.instanceId}:${index}`} className='flex gap-2 py-0.5'>
                      <span className='w-5 text-right text-neutral-400'>{index}</span>
                      <span className='font-medium'>{framePou?.name ?? `POU ${frame.pouId}`}</span>
                      <span className='text-neutral-500'>{frameInstance?.path ?? 'static'}</span>
                      <span className='ml-auto text-neutral-400'>L{frameStatement?.line ?? '?'}</span>
                    </div>
                  )
                })
              )}
            </section>
            <section className='overflow-auto p-2'>
              <div className='mb-1 font-semibold text-neutral-700 dark:text-neutral-200'>Locals</div>
              {currentIecDebugLocals.map((variable) => (
                <div key={variable.id} className='flex gap-2 py-0.5 font-mono'>
                  <span className='truncate text-neutral-700 dark:text-neutral-200'>
                    {currentIecDebugInstance
                      ? variable.path.replace(`${currentIecDebugInstance.path}.`, '')
                      : variable.path}
                  </span>
                  <span className='ml-auto text-neutral-400'>{variable.type}</span>
                  <span className='w-28 truncate text-right text-brand'>{iecDebugLocalValues.get(variable.id) ?? '…'}</span>
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
      <Modal
        open={advancedBreakpointOpen}
        onOpenChange={(open) => {
          if (!open) closeAdvancedBreakpointDialog()
        }}
      >
        <ModalContent className='flex h-fit min-h-0 w-[640px] select-none flex-col gap-4 rounded-lg p-6'>
          <ModalTitle className='text-lg font-semibold text-neutral-950 dark:text-white'>
            Advanced IEC Breakpoint
          </ModalTitle>
          <div className='text-sm text-neutral-600 dark:text-neutral-300'>
            Separate options with semicolons, for example:
            <div className='mt-2 rounded bg-neutral-100 px-3 py-2 font-mono text-xs dark:bg-neutral-850'>
              instance=DEBUGTEST.PUMP2; Counter&gt;=10; change=Counter; hit=100
            </div>
          </div>
          <label htmlFor='iec-breakpoint-specification' className='text-sm font-medium text-neutral-800 dark:text-neutral-100'>
            Breakpoint specification for line {advancedBreakpointLine ?? '?'}
          </label>
          <input
            id='iec-breakpoint-specification'
            autoFocus
            className='h-10 w-full rounded-md border border-neutral-200 bg-white px-3 font-mono text-sm text-neutral-900 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100'
            value={advancedBreakpointSpecification}
            onChange={(event) => setAdvancedBreakpointSpecification(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitAdvancedBreakpoint()
              }
            }}
          />
          <div className='flex justify-end gap-3'>
            <button
              type='button'
              className='h-9 rounded-md bg-neutral-100 px-5 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
              onClick={closeAdvancedBreakpointDialog}
            >
              Cancel
            </button>
            <button
              type='button'
              className='h-9 rounded-md bg-brand px-5 font-medium text-white'
              onClick={submitAdvancedBreakpoint}
            >
              Set Breakpoint
            </button>
          </div>
        </ModalContent>
      </Modal>
      <Modal open={isOpen} onOpenChange={setIsOpen}>
        <ModalContent className='flex h-56 w-96 select-none flex-col justify-between gap-2 rounded-lg p-8'>
          <ModalTitle className='text-sm font-medium text-neutral-950 dark:text-white'>
            Please enter a name for the block
          </ModalTitle>
          <label htmlFor='Block name' className='text-xs text-neutral-600 dark:text-neutral-50'>
            Block name
          </label>
          <input
            id='Block name'
            className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className='flex h-8 w-full justify-evenly gap-7'>
            <button
              onClick={handleCancelRenamePou}
              className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'
            >
              Cancel
            </button>
            <button
              type='button'
              className={`h-8 w-52 rounded-lg bg-brand text-white ${!newName || newName === '' ? 'cursor-not-allowed opacity-50' : ''}`}
              onClick={handleRenamePou}
              disabled={!newName || newName === ''}
            >
              Ok
            </button>
          </div>
        </ModalContent>
      </Modal>
    </>
  )
}
export { MonacoEditor }
