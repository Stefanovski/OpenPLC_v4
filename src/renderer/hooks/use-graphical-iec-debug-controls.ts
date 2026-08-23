import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { findGraphicalDebugBinding } from '@root/renderer/utils/graphical-debug'
import { buildIecDebugBreakpoint, resolveIecDebugInstance } from '@root/renderer/utils/iec-debug'
import type { IecDebugResumeMode } from '@root/types/PLC/iec-debug'
import { useCallback, useEffect, useMemo, useState } from 'react'

const IEC_DEBUG_CAP_STEP_OVER = 1 << 5
const IEC_DEBUG_CAP_STEP_OUT = 1 << 6

type GraphicalDebugSelection = {
  nodeId: string
  rungId?: string
}

const useGraphicalIecBreakpoint = (selection?: GraphicalDebugSelection) => {
  const {
    editor,
    workspace: { iecDebugMetadata, iecDebugBreakpoints },
    workspaceActions: { setIecDebugBreakpoints },
  } = useOpenPLCStore()

  const binding = useMemo(
    () =>
      selection
        ? findGraphicalDebugBinding(iecDebugMetadata, editor.meta.name, selection.nodeId, selection.rungId)
        : undefined,
    [editor.meta.name, iecDebugMetadata, selection?.nodeId, selection?.rungId],
  )
  const hasBreakpoint = binding ? iecDebugBreakpoints.has(binding.breakpoint_statement_id) : false

  const toggleBreakpoint = useCallback(() => {
    if (!binding) {
      toast({
        title: 'No executable graphical element selected',
        description: 'Select a mapped block, FBD output, or LD coil before pressing F9.',
        variant: 'fail',
      })
      return
    }
    const statementId = binding.breakpoint_statement_id
    const enabled = !iecDebugBreakpoints.has(statementId)
    void window.bridge.debuggerSetIecBreakpoint(statementId, enabled).then((result) => {
      if (!result.success) {
        toast({
          title: 'Breakpoint Error',
          description: result.error ?? 'Breakpoint could not be changed.',
          variant: 'fail',
        })
        return
      }
      const next = new Set(iecDebugBreakpoints)
      if (enabled) next.add(statementId)
      else next.delete(statementId)
      setIecDebugBreakpoints(next)
    })
  }, [binding, iecDebugBreakpoints, setIecDebugBreakpoints])

  return { binding, hasBreakpoint, toggleBreakpoint }
}

const useGraphicalIecDebugControls = (selection?: GraphicalDebugSelection) => {
  const {
    editor,
    workspace: {
      isDebuggerVisible,
      iecDebugMetadata,
      iecDebugStatus,
      iecDebugCapabilities,
      iecDebugCallStack,
      iecDebugBreakpoints,
      fbDebugInstances,
      fbSelectedInstance,
    },
    workspaceActions: { setIecDebugBreakpoints },
  } = useOpenPLCStore()
  const { binding, hasBreakpoint, toggleBreakpoint } = useGraphicalIecBreakpoint(selection)
  const [advancedBreakpointOpen, setAdvancedBreakpointOpen] = useState(false)
  const [advancedBreakpointSpecification, setAdvancedBreakpointSpecification] = useState('')
  const isHalted = iecDebugStatus?.state === 1
  const isGraphicalSession =
    isDebuggerVisible &&
    iecDebugMetadata !== null &&
    editor.type === 'plc-graphical' &&
    (editor.graphical.language === 'fbd' || editor.graphical.language === 'ld')

  const selectedInstance = useMemo(() => {
    const fbTypeKey = editor.meta.name.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    const selected = (fbDebugInstances.get(fbTypeKey) ?? []).find((instance) => instance.key === selectedKey)
    const selectedPath = selected?.path ?? (selected ? `${selected.programName}.${selected.fbVariableName}` : undefined)
    return resolveIecDebugInstance(iecDebugMetadata, editor.meta.name, iecDebugStatus?.currentInstanceId, selectedPath)
  }, [editor.meta.name, fbDebugInstances, fbSelectedInstance, iecDebugMetadata, iecDebugStatus?.currentInstanceId])

  const resume = useCallback((mode: IecDebugResumeMode) => {
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

  const closeAdvancedBreakpoint = useCallback(() => {
    setAdvancedBreakpointOpen(false)
    setAdvancedBreakpointSpecification('')
  }, [])

  const openAdvancedBreakpoint = useCallback(() => {
    if (!binding || !iecDebugMetadata) {
      toast({
        title: 'No executable graphical element selected',
        description: 'Select a mapped block, FBD output, or LD coil before pressing Shift+F9.',
        variant: 'fail',
      })
      return
    }
    setAdvancedBreakpointSpecification(selectedInstance ? `instance=${selectedInstance.path}` : '')
    setAdvancedBreakpointOpen(true)
  }, [binding, iecDebugMetadata, selectedInstance])

  const submitAdvancedBreakpoint = useCallback(() => {
    if (!binding || !iecDebugMetadata) return
    const statement = iecDebugMetadata.statements.find((candidate) => candidate.id === binding.breakpoint_statement_id)
    if (!statement) {
      toast({ title: 'Breakpoint Error', description: 'The mapped IEC statement is unavailable.', variant: 'fail' })
      return
    }
    try {
      const breakpoint = buildIecDebugBreakpoint(
        { metadata: iecDebugMetadata, statement, currentInstance: selectedInstance },
        advancedBreakpointSpecification,
      )
      void window.bridge.debuggerSetIecBreakpointEx(breakpoint, true).then((result) => {
        if (!result.success) {
          toast({ title: 'Breakpoint Error', description: result.error, variant: 'fail' })
          return
        }
        const next = new Set(iecDebugBreakpoints)
        next.add(statement.id)
        setIecDebugBreakpoints(next)
        closeAdvancedBreakpoint()
      })
    } catch (error) {
      toast({
        title: 'Breakpoint Error',
        description: error instanceof Error ? error.message : String(error),
        variant: 'fail',
      })
    }
  }, [
    advancedBreakpointSpecification,
    binding,
    closeAdvancedBreakpoint,
    iecDebugBreakpoints,
    iecDebugMetadata,
    selectedInstance,
    setIecDebugBreakpoints,
  ])

  useEffect(() => {
    if (!isGraphicalSession) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F9') {
        event.preventDefault()
        if (event.shiftKey) {
          openAdvancedBreakpoint()
          return
        }
        toggleBreakpoint()
      } else if (event.key === 'F5' && isHalted) {
        event.preventDefault()
        resume('continue')
      } else if (event.key === 'F10' && isHalted && (iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OVER) !== 0) {
        event.preventDefault()
        resume('step-over')
      } else if (event.key === 'F11' && isHalted) {
        event.preventDefault()
        if (!event.shiftKey) resume('step-into')
        else if ((iecDebugCapabilities & IEC_DEBUG_CAP_STEP_OUT) !== 0 && iecDebugCallStack.length > 1) {
          resume('step-out')
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    iecDebugCallStack.length,
    iecDebugCapabilities,
    isGraphicalSession,
    isHalted,
    openAdvancedBreakpoint,
    resume,
    toggleBreakpoint,
  ])

  return {
    binding,
    hasBreakpoint,
    isGraphicalSession,
    isHalted,
    resume,
    toggleBreakpoint,
    advancedBreakpointOpen,
    advancedBreakpointSpecification,
    selectedInstance,
    setAdvancedBreakpointSpecification,
    openAdvancedBreakpoint,
    closeAdvancedBreakpoint,
    submitAdvancedBreakpoint,
  }
}

export { useGraphicalIecBreakpoint, useGraphicalIecDebugControls }
