import { BlockNodeData } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { GraphicalIecBreakpointDialog } from '@root/renderer/components/_atoms/graphical-editor/graphical-iec-breakpoint-dialog'
import { GraphicalIecDebugToolbar } from '@root/renderer/components/_atoms/graphical-editor/graphical-iec-debug-toolbar'
import { BlockVariant } from '@root/renderer/components/_atoms/graphical-editor/types/block'
import { FBDBody } from '@root/renderer/components/_molecules/graphical-editor/fbd'
import { useGraphicalIecDebugControls } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { zodFBDFlowSchema } from '@root/renderer/store/slices'
import { useEffect, useMemo } from 'react'

export default function FbdEditor() {
  const editor = useOpenPLCStore((state) => state.editor)
  const fbdFlows = useOpenPLCStore((state) => state.fbdFlows)
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const userLibraries = useOpenPLCStore((state) => state.libraries.user)
  const fbdFlowActions = useOpenPLCStore((state) => state.fbdFlowActions)
  const updatePou = useOpenPLCStore((state) => state.projectActions.updatePou)
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    (state) => state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState,
  )
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const flow = fbdFlows.find((flow) => flow.name === editor.meta.name)
  const flowUpdated = flow?.updated || false
  const selectedNode = flow?.rung.selectedNodes.at(-1)
  const graphicalDebugControls = useGraphicalIecDebugControls(selectedNode ? { nodeId: selectedNode.id } : undefined)

  const nodeDivergences = useMemo(() => {
    if (!flow) return []

    const divergences = []

    for (const node of flow.rung.nodes) {
      const variant = (node.data as BlockNodeData<BlockVariant>)?.variant
      if (!variant) continue

      const libMatch = userLibraries.find((lib) => lib.name === variant.name && lib.type === variant.type)
      if (!libMatch) continue

      const originalPou = pous.find((pou) => pou.data.name === libMatch.name)
      if (!originalPou) continue

      const originalVariables = originalPou.data?.variables ?? []
      const originalInOut = originalVariables?.filter((variable) =>
        ['input', 'output', 'inOut'].includes(variable.class || ''),
      )

      const currentVariables = variant.variables.filter(
        (variable) =>
          ['input', 'output', 'inOut'].includes(variable.class || '') && !['OUT', 'EN', 'ENO'].includes(variable.name),
      )

      const formatVariable = (variable: {
        name: string
        class?: string
        type: { definition: string; value: string }
      }) => `${variable.name}|${variable.class}|${variable.type.definition}|${variable.type.value?.toLowerCase()}`

      if (originalPou.type === 'function') {
        const outVariable = variant.variables.find((v) => v.name === 'OUT')
        const outType = outVariable?.type?.value?.toUpperCase()
        const returnType = originalPou.data.returnType?.toUpperCase()
        if (!outType || !returnType || outType !== returnType) {
          divergences.push(node.id)
          continue
        }
      }

      const currentMap = new Map(currentVariables.map((variable) => [formatVariable(variable), true]))
      const hasDivergence =
        originalInOut?.length !== currentVariables.length ||
        !originalInOut?.every((variable) => currentMap.has(formatVariable(variable)))

      if (hasDivergence) {
        divergences.push(node.id)
      }
    }

    return divergences
  }, [flow?.rung.nodes, userLibraries, pous])

  /**
   * Update the flow state to project JSON
   */
  useEffect(() => {
    if (!flowUpdated) return

    const flowSchema = zodFBDFlowSchema.safeParse(flow)
    if (!flowSchema.success) return

    updatePou({
      name: editor.meta.name,
      content: {
        language: 'fbd',
        value: flowSchema.data,
      },
    })

    fbdFlowActions.setFlowUpdated({ editorName: editor.meta.name, updated: false })
    handleFileAndWorkspaceSavedState(editor.meta.name)
  }, [flowUpdated])

  return (
    <div className='relative h-full w-full'>
      <GraphicalIecDebugToolbar
        isSession={graphicalDebugControls.isGraphicalSession}
        isHalted={graphicalDebugControls.isHalted}
        resume={graphicalDebugControls.resume}
      />
      <GraphicalIecBreakpointDialog
        open={graphicalDebugControls.advancedBreakpointOpen}
        specification={graphicalDebugControls.advancedBreakpointSpecification}
        elementName={selectedNode?.id}
        instancePath={graphicalDebugControls.selectedInstance?.path}
        onSpecificationChange={graphicalDebugControls.setAdvancedBreakpointSpecification}
        onClose={graphicalDebugControls.closeAdvancedBreakpoint}
        onSubmit={graphicalDebugControls.submitAdvancedBreakpoint}
      />
      {flow?.rung ? (
        <FBDBody
          rung={flow?.rung}
          nodeDivergences={nodeDivergences}
          isDebuggerActive={isDebuggerVisible}
          selectedInstanceId={graphicalDebugControls.selectedInstance?.id}
        />
      ) : (
        <span>No rung found for editor</span>
      )}
    </div>
  )
}
