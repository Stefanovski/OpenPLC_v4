import { useDebugCompositeKey } from '@hooks/use-debug-composite-key'
import { CustomFbdNodeTypes, customNodeTypes } from '@root/renderer/components/_atoms/graphical-editor/fbd'
import { BlockNode } from '@root/renderer/components/_atoms/graphical-editor/fbd/block'
import { GraphicalDebugStatus } from '@root/renderer/components/_atoms/graphical-editor/graphical-debug-status'
import { getVariableRestrictionType } from '@root/renderer/components/_atoms/graphical-editor/utils'
import { ReactFlowPanel } from '@root/renderer/components/_atoms/react-flow'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import BlockElement from '@root/renderer/components/_features/[workspace]/editor/graphical/elements/fbd/block'
import { openPLCStoreBase, useOpenPLCStore } from '@root/renderer/store'
import { FBDRungState } from '@root/renderer/store/slices'
import { getFunctionBlockVariablesToCleanup } from '@root/renderer/store/slices/ladder/utils'
import {
  applyGraphicalBooleanNegation,
  getGraphicalDebugSample,
  getGraphicalDebugSourcesForStatement,
  getGraphicalIecDebugNodeState,
  type GraphicalDebugSample,
  parseGraphicalDebugBoolean,
  resolveFbdEdgeSamples,
} from '@root/renderer/utils/graphical-debug'
import { cn } from '@root/utils'
import { newGraphicalEditorNodeID } from '@root/utils/new-graphical-editor-node-id'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Connection,
  Edge as FlowEdge,
  Node as FlowNode,
  OnEdgesChange,
  OnNodeDrag,
  OnNodesChange,
  ReactFlowInstance,
  SelectionMode,
  XYPosition,
} from '@xyflow/react'
import { debounce, isEqual } from 'lodash'
import { DragEventHandler, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildGenericNode } from './fbd-utils/nodes'
import { useFBDClipboard } from './fbd-utils/useCopyPaste'

const EDGE_COLOR_TRUE = '#00FF00'
const EDGE_COLOR_FALSE = '#0464FB'
const EDGE_COLOR_VALUE = '#38BDF8'
const EDGE_COLOR_STALE = '#F59E0B'
const UNAVAILABLE_GRAPHICAL_SAMPLE: GraphicalDebugSample = { value: undefined, quality: 'unavailable' }

interface FBDProps {
  rung: FBDRungState
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
  selectedInstanceId?: number
}

export const FBDBody = ({ rung, nodeDivergences = [], isDebuggerActive = false, selectedInstanceId }: FBDProps) => {
  const {
    editor,
    editorActions: { updateModelVariables, saveEditorViewState },
    fbdFlowActions,
    libraries,
    project,
    projectActions: { deleteVariable },
    modals,
    modalActions: { closeModal, openModal },
    snapshotActions: { addSnapshot },
    workspace: {
      isDebuggerVisible,
      debugVariableValues,
      debugVariableUpdatedAt,
      debugForcedVariables,
      iecDebugMetadata,
      iecDebugStatus,
      iecDebugBreakpoints,
    },
  } = useOpenPLCStore()
  const getCompositeKey = useDebugCompositeKey()

  const pous = project.data.pous

  const pouRef = pous.find((pou) => pou.data.name === editor.meta.name)

  const [rungLocal, setRungLocal] = useState<FBDRungState>(rung)
  const [dragging, setDragging] = useState(false)

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const reactFlowViewportRef = useRef<HTMLDivElement>(null)

  const [insideViewport, setInsideViewport] = useState(false)
  const [mousePosition, setMousePosition] = useState<XYPosition>({ x: 0, y: 0 })

  useEffect(() => {
    if (!reactFlowInstance || iecDebugStatus?.state !== 1) return
    if (selectedInstanceId !== undefined && iecDebugStatus.currentInstanceId !== selectedInstanceId) return
    const currentBinding = getGraphicalDebugSourcesForStatement(
      iecDebugMetadata,
      iecDebugStatus.currentPouId,
      iecDebugStatus.currentStatementId,
    ).primary
    if (currentBinding?.language !== 'fbd') return
    if (!currentBinding) return
    const currentNode = reactFlowInstance.getNode(currentBinding.node_id)
    if (currentNode) void reactFlowInstance.fitView({ nodes: [currentNode], duration: 180, padding: 0.45 })
  }, [iecDebugMetadata, iecDebugStatus, reactFlowInstance, selectedInstanceId])

  useFBDClipboard({
    mousePosition,
    insideViewport,
    reactFlowInstance,
    rung,
    handleDeleteNodes: (nodes, edges) => {
      handleOnDelete(nodes, edges)
    },
  })

  const getNodeOutputSample = (nodeId: string, sourceHandle: string | null | undefined): GraphicalDebugSample => {
    if (!isDebuggerVisible) return UNAVAILABLE_GRAPHICAL_SAMPLE

    const node = rungLocal.nodes.find((n) => n.id === nodeId)
    if (!node) return UNAVAILABLE_GRAPHICAL_SAMPLE

    if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
      const variableData = node.data as { variable?: { name: string }; negated?: boolean }
      const variableName = variableData.variable?.name
      if (!variableName) return UNAVAILABLE_GRAPHICAL_SAMPLE

      if (!pouRef) return UNAVAILABLE_GRAPHICAL_SAMPLE
      const variable = pouRef.data.variables.find((v) => v.name.toLowerCase() === variableName.toLowerCase())
      if (!variable) return UNAVAILABLE_GRAPHICAL_SAMPLE

      const compositeKey = getCompositeKey(variableName)

      if (variable.type.value.toUpperCase() === 'BOOL' && debugForcedVariables.has(compositeKey)) {
        return applyGraphicalBooleanNegation(
          {
            value: debugForcedVariables.get(compositeKey) ? 'TRUE' : 'FALSE',
            quality: 'sampled',
          },
          variableData.negated,
        )
      }

      return applyGraphicalBooleanNegation(
        getGraphicalDebugSample(debugVariableValues, debugVariableUpdatedAt, compositeKey),
        variableData.negated,
      )
    }

    if (node.type === 'block') {
      const blockData = node.data as {
        variable?: { name: string }
        variant?: { name: string; type: string; variables: Array<{ name: string; type: { value: string } }> }
      }
      if (!sourceHandle) return UNAVAILABLE_GRAPHICAL_SAMPLE

      // For program POUs, verify the program instance exists
      // For FB POUs, skip this check since getCompositeKey already handles instance context
      if (pouRef?.type !== 'function-block') {
        const instances = project.data.configuration.resource.instances
        const programInstance = instances.find((inst: { program: string }) => inst.program === editor.meta.name)
        if (!programInstance) return UNAVAILABLE_GRAPHICAL_SAMPLE
      }

      const outputVariable = blockData.variant?.variables.find((v) => v.name === sourceHandle)
      if (!outputVariable) return UNAVAILABLE_GRAPHICAL_SAMPLE

      if (blockData.variant?.type === 'function-block') {
        const blockVariableName = blockData.variable?.name
        if (!blockVariableName) return UNAVAILABLE_GRAPHICAL_SAMPLE

        const outputVariableName = `${blockVariableName}.${sourceHandle}`
        const compositeKey = getCompositeKey(outputVariableName)
        return getGraphicalDebugSample(debugVariableValues, debugVariableUpdatedAt, compositeKey)
      } else if (blockData.variant?.type === 'function') {
        const blockName = blockData.variant.name.toUpperCase()
        const numericId = (node.data as { numericId?: string }).numericId
        if (!numericId) return UNAVAILABLE_GRAPHICAL_SAMPLE

        const tempVarName = `_TMP_${blockName}${numericId}_${sourceHandle.toUpperCase()}`
        const compositeKey = getCompositeKey(tempVarName)
        return getGraphicalDebugSample(debugVariableValues, debugVariableUpdatedAt, compositeKey)
      }

      return UNAVAILABLE_GRAPHICAL_SAMPLE
    }

    return UNAVAILABLE_GRAPHICAL_SAMPLE
  }

  const styledEdges = useMemo(() => {
    if (!isDebuggerVisible) {
      return rungLocal.edges
    }

    const edgeSampleMap = resolveFbdEdgeSamples(rungLocal.nodes, rungLocal.edges, getNodeOutputSample)

    return rungLocal.edges.map((edge) => {
      const sample = edgeSampleMap.get(edge.id) ?? UNAVAILABLE_GRAPHICAL_SAMPLE

      const booleanValue = parseGraphicalDebugBoolean(sample)
      const stroke =
        sample.quality === 'unavailable' || sample.quality === 'type-error' || sample.quality === 'build-mismatch'
          ? EDGE_COLOR_STALE
          : sample.quality === 'stale'
            ? EDGE_COLOR_STALE
            : booleanValue === true
              ? EDGE_COLOR_TRUE
              : booleanValue === false
                ? EDGE_COLOR_FALSE
                : EDGE_COLOR_VALUE

      return {
        ...edge,
        data: { ...edge.data, debugQuality: sample.quality },
        label:
          sample.value === undefined
            ? sample.quality
            : `${sample.value}${sample.quality === 'sampled' ? '' : ` (${sample.quality})`}`,
        labelStyle: { fill: stroke, fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#111827', fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 3,
        style: {
          ...edge.style,
          stroke,
          strokeWidth: 2,
          strokeDasharray: ['stale', 'unavailable', 'type-error', 'build-mismatch'].includes(sample.quality)
            ? '5 4'
            : undefined,
        },
      }
    })
  }, [
    rungLocal.edges,
    rungLocal.nodes,
    isDebuggerVisible,
    debugVariableValues,
    debugVariableUpdatedAt,
    debugForcedVariables,
    editor.meta.name,
    pouRef?.data.variables,
    project.data.configuration.resource.instances,
  ])

  const styledNodes = useMemo(() => {
    if (isDebuggerActive) {
      return rungLocal.nodes.map((node) => {
        const debugState = getGraphicalIecDebugNodeState(
          iecDebugMetadata,
          iecDebugStatus,
          iecDebugBreakpoints,
          editor.meta.name,
          node.id,
          undefined,
          selectedInstanceId,
        )
        return {
          ...node,
          className: cn(node.className, {
            'iec-graphical-debug-mapped': debugState.binding,
            'iec-graphical-debug-current': debugState.isCurrent,
            'iec-graphical-debug-related': debugState.isSecondaryCurrent,
            'iec-graphical-debug-breakpoint': debugState.hasBreakpoint,
          }),
          draggable: false,
          selectable: true,
          deletable: false,
        }
      })
    }

    return rungLocal.nodes
  }, [
    editor.meta.name,
    iecDebugBreakpoints,
    iecDebugMetadata,
    iecDebugStatus,
    isDebuggerActive,
    rungLocal.nodes,
    selectedInstanceId,
  ])

  const nodeTypes = useMemo(() => customNodeTypes, [])
  const canZoom = useMemo(() => {
    if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
      return editor.graphical.canEditorZoom
    }
    return false
  }, [editor])
  const canPan = useMemo(() => {
    if (editor.type === 'plc-graphical' && editor.graphical.language === 'fbd') {
      return editor.graphical.canEditorPan
    }
    return false
  }, [editor])

  const updateRungLocalFromStore = () => {
    setRungLocal({
      ...rung,
      nodes: rung.nodes.map((node) => ({
        ...node,
        data: { ...node.data, hasDivergence: nodeDivergences.includes(node.id) },
      })),
    })
  }

  const updateRungState = () => {
    const stripDivergence = (node: FlowNode) => {
      const { hasDivergence: _hd, ...cleanData } = node.data
      return { ...node, data: cleanData }
    }

    const rungLocalCopy = {
      ...rungLocal,
      nodes: rungLocal.nodes.map(stripDivergence),
    }

    const rungClean = {
      ...rung,
      nodes: rung.nodes.map(stripDivergence),
    }

    // Make node data mirror be the rung and not the rungLocal
    // This is made because the rungLocal is a local copy and may not reflect the latest changes in the store
    // And the store saves all the block data updates
    const isSelectedNodeDataEqual =
      rungClean.selectedNodes.length > 0
        ? rungClean.selectedNodes.every((node) => {
            const localNode = rungLocalCopy.nodes.find((n) => n.id === node.id)
            return localNode ? isEqual(localNode.data, node.data) : false
          })
        : true
    const skipUpdate = (dragging || isEqual(rungLocalCopy, rungClean)) && isSelectedNodeDataEqual

    if (skipUpdate) {
      return
    }

    const selectedNodes = rungLocalCopy.nodes.filter((node) => node.selected)
    fbdFlowActions.setRung({
      editorName: editor.meta.name,
      rung: {
        ...rungLocalCopy,
        selectedNodes,
      },
    })
  }

  /**
   *  * FYI: This implementation came from https://www.developerway.com/posts/debouncing-in-react
   */
  // creating ref and initializing it with the sendRequest function
  const debounceUpdateRungRef = useRef(updateRungState)
  useEffect(() => {
    // updating ref when state changes
    // now, ref.current will have the latest sendRequest with access to the latest state
    debounceUpdateRungRef.current = updateRungState
  }, [dragging, rungLocal, rung])
  // creating debounced callback only once - on mount
  const debouncedUpdateRungStateCallback = useMemo(() => {
    // func will be created only once - on mount
    const func = () => {
      // ref is mutable! ref.current is a reference to the latest sendRequest
      debounceUpdateRungRef.current?.()
    }
    // debounce the func that was created once, but has access to the latest sendRequest
    const timer = dragging ? 100 : 10
    return debounce(func, timer)
    // no dependencies! never gets updated
  }, [dragging])

  useEffect(() => {
    updateRungLocalFromStore()
  }, [rung])

  useEffect(() => {
    debouncedUpdateRungStateCallback()
    return () => debouncedUpdateRungStateCallback.cancel()
  }, [rungLocal])

  /**
   * Handle screen position changes
   */
  useEffect(() => {
    const unsub = openPLCStoreBase.subscribe(
      (state) => state.editor.meta.name,
      (newName, prevEditorName) => {
        if (newName === prevEditorName || !reactFlowInstance) return

        const { x, y, zoom } = reactFlowInstance.getViewport()

        saveEditorViewState({
          prevEditorName,
          fbdPosition: { x, y, zoom },
        })
      },
    )

    return () => unsub()
  }, [reactFlowInstance])

  useEffect(() => {
    if (editor.type !== 'plc-graphical') return
    const viewport = editor.fbdPosition
    if (!reactFlowInstance || !viewport) return

    setTimeout(() => {
      void reactFlowInstance.setViewport(viewport, { duration: 0 })
    }, 0)
  }, [reactFlowInstance, editor.meta.name])

  /**
   * Handle the addition of a new element by dropping it in the viewport
   */
  const handleAddElementByDropping = (
    position: XYPosition,
    newNodeType: CustomFbdNodeTypes,
    library: string | undefined,
  ) => {
    addSnapshot(editor.meta.name)

    let pouLibrary = undefined
    if (library) {
      const [blockLibraryType, blockLibrary, pouName] = library.split('/')

      if (blockLibraryType === 'system')
        pouLibrary = libraries.system
          .find((Library) => Library.name === blockLibrary)
          ?.pous.find((p) => p.name === pouName)

      if (blockLibraryType === 'user') {
        const library = libraries.user.find((library) => library.name === blockLibrary)
        const pou = pous.find((pou) => pou.data.name === library?.name)
        if (!pou) return
        const variables = pou.data.variables.map((variable) => ({
          name: variable.name,
          class: variable.class,
          type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
        }))

        if (pou.type === 'function') {
          const variable = getVariableRestrictionType(pou.data.returnType)
          variables.push({
            name: 'OUT',
            class: 'output',
            type: {
              definition: (variable.definition as 'array' | 'base-type' | 'user-data-type' | 'derived') ?? 'derived',
              value: pou.data.returnType.toUpperCase(),
            },
          })
        }

        pouLibrary = {
          name: pou.data.name,
          type: pou.type,
          variables: variables,
          documentation: pou.data.documentation,
          extensible: false,
        }
      }

      if (!pouLibrary) {
        toast({
          title: 'Can not add block',
          description: `The block type ${library} does not exist in the library`,
          variant: 'fail',
        })
        return
      }
    }

    const newNode = buildGenericNode({
      id: newGraphicalEditorNodeID(newNodeType.toUpperCase()),
      position,
      nodeType: newNodeType,
      blockType: pouLibrary,
    })

    if (!newNode) {
      toast({
        title: 'Can not add block',
        description: `Internal error`,
        variant: 'fail',
      })
      return
    }

    fbdFlowActions.addNode({
      node: newNode,
      editorName: editor.meta.name,
    })
  }

  /**
   * Handle the deletion of nodes and edges
   * This function is called when the user presses the delete key
   * It is used to remove the selected nodes and edges from the flow
   */
  const handleOnDelete = (nodes: FlowNode[], edges: FlowEdge[]) => {
    addSnapshot(editor.meta.name)

    if (nodes.length > 0) {
      fbdFlowActions.removeNodes({
        nodes: nodes,
        editorName: editor.meta.name,
      })

      if (pouRef && nodes.length > 0) {
        const allVariables = pouRef.data.variables
        const allRungs = [rung]

        const variablesToDelete = getFunctionBlockVariablesToCleanup(nodes, allRungs, allVariables)

        variablesToDelete.forEach((variableName) => {
          const variableIndex = allVariables.findIndex((v) => v.name.toLowerCase() === variableName.toLowerCase())

          if (variableIndex !== -1) {
            deleteVariable({
              variableName,
              scope: 'local',
              associatedPou: editor.meta.name,
            })

            if (
              editor.type === 'plc-graphical' &&
              editor.variable.display === 'table' &&
              parseInt(editor.variable.selectedRow) === variableIndex
            ) {
              updateModelVariables({ display: 'table', selectedRow: -1 })
            }
          }
        })
      }
    }

    if (edges.length > 0) {
      fbdFlowActions.removeEdges({
        edges: edges,
        editorName: editor.meta.name,
      })
    }
  }

  /**
   * Handle the connection of two nodes
   * This function is called when the user connects two nodes
   * It is used to update the local rung state
   */
  const handleOnConnect = (connection: Connection) => {
    addSnapshot(editor.meta.name)

    setRungLocal((rung) => ({
      ...rung,
      edges: addEdge(connection, rung.edges),
    }))

    fbdFlowActions.onConnect({
      changes: connection,
      editorName: editor.meta.name,
    })
  }

  /**
   * Handle the change of the nodes
   * This function is called every time the nodes change
   * It is used to update the local rung state
   */
  const onNodesChange: OnNodesChange<FlowNode> = useCallback(
    (changes) => {
      setRungLocal((newRung) => {
        let nodes = newRung.nodes
        let selectedNodes: FlowNode[] = newRung.nodes.filter((node) => node.selected)

        changes.forEach((change) => {
          switch (change.type) {
            case 'select': {
              const node = newRung.nodes.find((n) => n.id === change.id) as FlowNode
              if (change.selected) {
                selectedNodes.push(node)
                return
              }
              selectedNodes = selectedNodes.filter((n) => n.id !== change.id)
              return
            }

            case 'dimensions': {
              if (change.resizing)
                nodes = newRung.nodes.map((n) => {
                  if (n.id === change.id) {
                    return {
                      ...n,
                      width: change.dimensions?.width,
                      height: change.dimensions?.height,
                      measured: {
                        width: change.dimensions?.width,
                        height: change.dimensions?.height,
                      },
                    }
                  }
                  return n
                })
              return
            }
          }
        })

        return {
          ...newRung,
          nodes: applyNodeChanges(changes, nodes),
          selectedNodes: selectedNodes,
        }
      })
    },
    [rungLocal, dragging],
  )

  const onEdgesChange: OnEdgesChange<FlowEdge> = useCallback(
    (changes) => {
      setRungLocal((rung) => ({
        ...rung,
        edges: applyEdgeChanges(changes, rung.edges),
      }))
    },
    [rungLocal, dragging],
  )

  const onNodeDragStart = useCallback(() => {
    setDragging(true)
  }, [rungLocal, dragging])

  /**
   * When the node drag stops, update the fbd rung state
   */
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, _node, nodes) => {
      setDragging(false)
      fbdFlowActions.setRung({
        editorName: editor.meta.name,
        rung: {
          ...rungLocal,
          nodes: rungLocal.nodes.map((node) => nodes.find((n) => n.id === node.id) ?? node),
          edges: rungLocal.edges,
        },
      })
    },
    [rungLocal, dragging],
  )

  /**
   * Handle the drag enter of the viewport
   * This function is called when a dragged element enters the viewport
   */
  const onDragEnterViewport = useCallback<DragEventHandler>(
    (event) => {
      event.preventDefault()
      // Check if the dragged element is not a ladder block
      if (!event.dataTransfer.types.includes('application/reactflow/fbd-blocks')) {
        return
      }
    },
    [reactFlowViewportRef],
  )

  /**
   * Handle the drag leave of the viewport
   * This function is called when a dragged element leaves the viewport
   */
  const onDragLeaveViewport = useCallback<DragEventHandler>(
    (event) => {
      // Check if the dragged element is a child of the flow viewport
      const { relatedTarget } = event
      if (
        !reactFlowViewportRef.current ||
        !relatedTarget ||
        reactFlowViewportRef.current.contains(relatedTarget as Node)
      ) {
        return
      }
    },
    [reactFlowViewportRef],
  )

  /**
   * Handle the drag over of the viewport
   * This function is called when a dragged element is over the viewport
   */
  const onDragOver = useCallback<DragEventHandler>(
    (event) => {
      if (!reactFlowInstance) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    [reactFlowInstance],
  )

  /**
   * Handle the drop of the viewport
   * This function is called when a dragged element is dropped in the viewport
   */
  const onDrop = useCallback<DragEventHandler>(
    (event) => {
      event.preventDefault()
      // Check if there is a ladder block in the dragged data
      const blockType =
        event.dataTransfer.getData('application/reactflow/fbd-blocks') === ''
          ? undefined
          : event.dataTransfer.getData('application/reactflow/fbd-blocks')

      if (!blockType || !Object.keys(customNodeTypes).includes(blockType)) {
        return
      }

      // Check if there is a library in the dragged data
      const library =
        event.dataTransfer.getData('application/library') === ''
          ? undefined
          : event.dataTransfer.getData('application/library')

      const position = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) ?? {
        x: 0,
        y: 0,
      }

      handleAddElementByDropping(position, blockType as CustomFbdNodeTypes, library)
    },
    [rung, reactFlowInstance],
  )

  /**
   * Handle the double click of a node
   */
  const handleNodeDoubleClick = (node: FlowNode) => {
    const modalToOpen = node.type === 'block' && 'block-fbd-element'
    if (!modalToOpen) return

    openModal(modalToOpen, node)
  }

  /**
   * Handle the close of the modal
   */
  const handleModalClose = () => {
    closeModal()
  }

  return (
    <div
      className='relative h-full w-full rounded-lg border p-1 dark:border-neutral-800'
      ref={reactFlowViewportRef}
      onMouseEnter={() => {
        setInsideViewport(true)
      }}
      onMouseLeave={() => {
        setInsideViewport(false)
        setMousePosition({ x: 0, y: 0 })
      }}
      onMouseMove={(event) => {
        setMousePosition({ x: event.clientX, y: event.clientY })
      }}
    >
      {isDebuggerVisible && <GraphicalDebugStatus />}
      <ReactFlowPanel
        key={'fbd-react-flow'}
        background={true}
        controls={true}
        controlsConfig={{
          showInteractive: false,
        }}
        viewportConfig={{
          onInit: setReactFlowInstance,

          nodeTypes,
          nodes: styledNodes,
          edges: styledEdges,

          defaultEdgeOptions: {
            type: 'smoothstep',
          },

          nodesDraggable: !isDebuggerActive,
          nodesConnectable: !isDebuggerActive,
          elementsSelectable: true,

          onDelete: isDebuggerActive
            ? undefined
            : ({ nodes, edges }) => {
                handleOnDelete(nodes, edges)
              },
          onConnect: isDebuggerActive
            ? undefined
            : (connection) => {
                handleOnConnect(connection)
              },
          onNodeDoubleClick: isDebuggerActive
            ? undefined
            : (_event, node) => {
                handleNodeDoubleClick(node)
              },

          onDragEnter: isDebuggerActive ? undefined : onDragEnterViewport,
          onDragLeave: isDebuggerActive ? undefined : onDragLeaveViewport,
          onDragOver: isDebuggerActive ? undefined : onDragOver,
          onDrop: isDebuggerActive ? undefined : onDrop,

          onNodesChange: onNodesChange,
          onEdgesChange: onEdgesChange,
          selectionMode: SelectionMode.Partial,

          onNodeDragStart: isDebuggerActive ? undefined : onNodeDragStart,
          onNodeDragStop: isDebuggerActive ? undefined : onNodeDragStop,

          preventScrolling: canZoom,
          panOnDrag: canPan,

          snapGrid: [16, 16],
          snapToGrid: true,

          proOptions: {
            hideAttribution: true,
          },
        }}
      />
      {modals['block-fbd-element']?.open && (
        <BlockElement
          onClose={handleModalClose}
          selectedNode={modals['block-fbd-element'].data as BlockNode<object>}
          isOpen={modals['block-fbd-element'].open}
        />
      )}
    </div>
  )
}
