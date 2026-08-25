import { ClearConsoleButton } from '@components/_atoms/buttons/console/clear-console'
import * as Tabs from '@radix-ui/react-tabs'
import { DebugTreeNode } from '@root/types/debugger'
import { baseTypeSchema } from '@root/types/PLC/open-plc'
import type { PLCBaseTypesLowercase } from '@root/types/PLC/units/base-types'
import { cn, isOpenPLCRuntimeTarget } from '@root/utils'
import { parseDimensionRange } from '@root/utils/PLC/array-variable-utils'
import { useEffect, useRef } from 'react'
import { useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ExitIcon } from '../assets'
import { DataTypeEditor, MonacoEditor } from '../components/_features/[workspace]/editor'
import { DeviceEditor } from '../components/_features/[workspace]/editor/device'
import { GraphicalEditor } from '../components/_features/[workspace]/editor/graphical'
import { ResourcesEditor } from '../components/_features/[workspace]/editor/resource-editor'
import { Search } from '../components/_features/[workspace]/search'
import { VariablesPanel } from '../components/_molecules/variables-panel'
import AboutModal from '../components/_organisms/about-modal'
import { Console as ConsoleComponent } from '../components/_organisms/console'
import { Debugger } from '../components/_organisms/debugger'
import { Explorer } from '../components/_organisms/explorer'
import {
  ConfirmDeviceSwitchModal,
  DebuggerIpInputModal,
  DebuggerMessageModal,
  RuntimeCreateUserModal,
  RuntimeLoginModal,
} from '../components/_organisms/modals'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { PlcLogs } from '../components/_organisms/plc-logs'
import { VariablesEditor } from '../components/_organisms/variables-editor'
import { WorkspaceActivityBar } from '../components/_organisms/workspace-activity-bar'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { StandardFunctionBlocks } from '../data/library/standard-function-blocks'
import { useOpenPLCStore } from '../store'
import { collectGraphicalDebugWatchKeys } from '../utils/graphical-debug'
import { buildFbDebugInstanceMap } from '../utils/iec-debug'
import { getVariableSize, parseVariableValue, toNativeIecDebugValue } from '../utils/variable-sizes'

const DEBUGGER_POLL_INTERVAL_MS = 50
const IEC_DEBUGGER_POLL_INTERVAL_MS = 100
const IEC_DEBUG_CAP_CALL_STACK = 1 << 7
const PLC_LOGS_POLL_INTERVAL_MS = 2500
const ENABLE_LEGACY_GRAPHICAL_WATCH_SCAN = false

const WorkspaceScreen = () => {
  const {
    tabs,
    workspace: {
      isCollapsed,
      isDebuggerVisible,
      isPlcLogsVisible,
      debugVariableValues,
      debugVariableTree,
      debugVariableIndexes,
      debugForcedVariables,
      debugExpandedNodes,
      iecDebugMetadata,
    },
    editor,
    workspaceActions: { toggleCollapse, setDebugForcedVariables, toggleDebugExpandedNode },
    deviceActions: { setAvailableOptions },
    searchResults,
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  // Get FB debug context for transforming FB variable keys
  const {
    workspace: { fbSelectedInstance, fbDebugInstances },
  } = useOpenPLCStore()

  const allDebugVariables = pous.flatMap((pou) => {
    return pou.data.variables
      .filter((v) => v.debug === true)
      .map((v) => {
        let typeValue = ''
        if (v.type.definition === 'base-type') {
          typeValue = v.type.value
        } else if (v.type.definition === 'user-data-type') {
          typeValue = v.type.value
        } else if (v.type.definition === 'array') {
          typeValue = v.type.value
        } else if (v.type.definition === 'derived') {
          typeValue = v.type.value
        }

        // For function block POUs, transform the key to use instance context
        let compositeKey: string
        let displayName: string
        if (pou.type === 'function-block') {
          const fbTypeKey = pou.data.name.toUpperCase() // Canonical key for map lookups
          const selectedKey = fbSelectedInstance.get(fbTypeKey)
          const instances = fbDebugInstances.get(fbTypeKey) || []
          const selectedInstance = instances.find((inst) => inst.key === selectedKey)

          if (selectedInstance) {
            // Transform to instance context: main:MOTOR_SPEED0.varName
            compositeKey = `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${v.name}`
            // Display with full path: main.MOTOR_SPEED0.varName
            displayName = `${selectedInstance.programName}.${selectedInstance.fbVariableName}.${v.name}`
          } else {
            // No instance selected, use original format
            compositeKey = `${pou.data.name}:${v.name}`
            displayName = v.name
          }
        } else {
          compositeKey = `${pou.data.name}:${v.name}`
          displayName = v.name
        }

        const variableValue = debugVariableValues.get(compositeKey)
        const displayValue = variableValue !== undefined ? variableValue : '-'

        return {
          pouName: pou.data.name,
          name: displayName,
          type: typeValue,
          value: displayValue,
          compositeKey,
        }
      })
  })

  const nameOccurrences = new Map<string, number>()
  allDebugVariables.forEach((v) => {
    nameOccurrences.set(v.name, (nameOccurrences.get(v.name) || 0) + 1)
  })

  const debugVariables = allDebugVariables.map((v) => {
    const hasConflict = nameOccurrences.get(v.name)! > 1
    return {
      name: hasConflict ? `[${v.pouName}] ${v.name}` : v.name,
      type: v.type,
      value: v.value,
      compositeKey: v.compositeKey,
    }
  })

  const watchedCompositeKeys = new Set<string>(allDebugVariables.map((v) => v.compositeKey))

  const forcedKeys = Array.from(debugForcedVariables.keys())
  const allKeys = new Set([...watchedCompositeKeys, ...forcedKeys])

  const filteredDebugVariableTree = debugVariableTree
    ? new Map<string, DebugTreeNode>(
        Array.from(debugVariableTree.entries() as Iterable<[string, DebugTreeNode]>).filter(([key]) =>
          allKeys.has(key),
        ),
      )
    : undefined

  const [graphList, setGraphList] = useState<string[]>([])
  const [isVariablesPanelCollapsed, setIsVariablesPanelCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState('console')

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)
  const graphListRef = useRef<string[]>([])
  const batchOffsetRef = useRef<number>(0)
  const lastIecNavigationHaltRef = useRef<string | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const { workspaceActions, consoleActions, project, deviceDefinitions } = useOpenPLCStore.getState()
    if (!isDebuggerVisible) {
      workspaceActions.setIecDebugMetadata(null)
      workspaceActions.setIecDebugStatus(null)
      return
    }

    let active = true
    let polling = false
    let pollingInterval: NodeJS.Timeout | null = null
    let debugCapabilities = 0

    const pollStatus = async () => {
      if (!active || polling) return
      polling = true
      try {
        const result = await window.bridge.debuggerGetIecStatus()
        if (active && result.success && result.data) {
          workspaceActions.setIecDebugStatus(result.data)
          if (result.data.state === 1) {
            if (lastIecNavigationHaltRef.current !== result.data.haltCount) {
              // A status request may have been in flight while Continue was pressed. Confirm the halt before
              // navigating, otherwise that stale response can switch Monaco back to the previously halted POU.
              const confirmed = await window.bridge.debuggerGetIecStatus()
              if (!active || !confirmed.success || !confirmed.data) return
              workspaceActions.setIecDebugStatus(confirmed.data)
              if (confirmed.data.state !== 1 || confirmed.data.haltCount !== result.data.haltCount) {
                workspaceActions.setIecDebugCallStack([])
                return
              }

              lastIecNavigationHaltRef.current = confirmed.data.haltCount
              if ((debugCapabilities & IEC_DEBUG_CAP_CALL_STACK) !== 0) {
                const stack = await window.bridge.debuggerGetIecCallStack()
                if (active && stack.success && stack.data) workspaceActions.setIecDebugCallStack(stack.data)
              }
              const state = useOpenPLCStore.getState()
              const debugPou = state.workspace.iecDebugMetadata?.pous.find(
                (candidate) => candidate.id === confirmed.data?.currentPouId,
              )
              const debugInstance = state.workspace.iecDebugMetadata?.instances.find(
                (candidate) => candidate.id === confirmed.data?.currentInstanceId,
              )
              if (debugPou && debugInstance?.pou_id === debugPou.id && debugInstance.kind === 'function-block') {
                const typeKey = debugPou.name.toUpperCase()
                const instance = (state.workspace.fbDebugInstances.get(typeKey) ?? []).find(
                  (candidate) => candidate.instanceId === debugInstance.id || candidate.path === debugInstance.path,
                )
                if (instance) state.workspaceActions.setFbSelectedInstance(typeKey, instance.key)
              }
              const projectPou = state.project.data.pous.find(
                (candidate) => candidate.data.name.toUpperCase() === debugPou?.name.toUpperCase(),
              )
              if (
                projectPou &&
                ['st', 'fbd', 'ld'].includes(projectPou.data.language) &&
                state.editor.meta.name !== projectPou.data.name
              ) {
                const directory = projectPou.type === 'function-block' ? 'function-blocks' : `${projectPou.type}s`
                state.sharedWorkspaceActions.openFile({
                  name: projectPou.data.name,
                  path: `/pous/${directory}/${projectPou.data.name}.json`,
                  elementType: { type: projectPou.type, language: projectPou.data.language },
                })
              }
            }
          } else {
            workspaceActions.setIecDebugCallStack([])
          }
        }
      } finally {
        polling = false
      }
    }

    const start = async () => {
      const capabilities = await window.bridge.debuggerGetIecCapabilities()
      if (!active || !capabilities.success) return
      debugCapabilities = capabilities.data ?? 0
      workspaceActions.setIecDebugCapabilities(debugCapabilities)

      const metadata = await window.bridge.debuggerReadIecMetadata(
        project.meta.path,
        deviceDefinitions.configuration.deviceBoard,
      )
      if (!active) return
      if (!metadata.success || !metadata.data) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `IEC debug metadata unavailable: ${metadata.error ?? 'Unknown error'}`,
        })
        return
      }

      workspaceActions.setIecDebugMetadata(metadata.data)
      const metadataInstancesByType = buildFbDebugInstanceMap(metadata.data, useOpenPLCStore.getState().project.data)
      if (metadataInstancesByType.size > 0) {
        workspaceActions.setFbDebugInstances(metadataInstancesByType)
        const selectedInstances = useOpenPLCStore.getState().workspace.fbSelectedInstance
        metadataInstancesByType.forEach((instances, typeKey) => {
          const selectedKey = selectedInstances.get(typeKey)
          if (!instances.some((instance) => instance.key === selectedKey)) {
            workspaceActions.setFbSelectedInstance(typeKey, instances[0].key)
          }
        })
      }
      await pollStatus()
      pollingInterval = setInterval(() => void pollStatus(), IEC_DEBUGGER_POLL_INTERVAL_MS)
    }

    void start()
    return () => {
      active = false
      if (pollingInterval) clearInterval(pollingInterval)
      workspaceActions.setIecDebugMetadata(null)
      workspaceActions.setIecDebugStatus(null)
      workspaceActions.setIecDebugCapabilities(0)
      workspaceActions.setIecDebugCallStack([])
      lastIecNavigationHaltRef.current = null
    }
  }, [isDebuggerVisible])

  // Keep graphListRef in sync with graphList state for use in polling
  useEffect(() => {
    graphListRef.current = graphList
  }, [graphList])

  type VariableInfo = {
    pouName: string
    variable: (typeof pous)[0]['data']['variables'][0]
  }
  const variableInfoMapRef = useRef<Map<number, VariableInfo[]> | null>(null)

  useEffect(() => {
    const {
      workspace: { isDebuggerVisible, debuggerTargetIp, debugVariableIndexes, iecDebugMetadata },
      deviceDefinitions,
      workspaceActions,
      project,
      runtimeConnection: { connectionStatus, ipAddress: runtimeIpAddress },
      deviceAvailableOptions: { availableBoards },
    } = useOpenPLCStore.getState()

    if (!isDebuggerVisible) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      variableInfoMapRef.current = null
      return
    }

    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const currentBoardInfo = availableBoards.get(boardTarget)
    const isRuntimeTarget = isOpenPLCRuntimeTarget(currentBoardInfo)
    const isRTU = deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledRTU
    const isTCP = deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledTCP

    if (isRuntimeTarget) {
      if (connectionStatus !== 'connected') {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
        variableInfoMapRef.current = null
        return
      }

      if (!runtimeIpAddress) {
        console.warn('No runtime IP address configured')
        return
      }
    } else {
      if (isTCP && !debuggerTargetIp) {
        console.warn('No debugger target IP address configured')
        return
      }

      if (!isTCP && !isRTU) {
        console.warn('No Modbus connection configured (neither TCP nor RTU)')
        return
      }
    }
    let pollingActive = true
    let batchSize = 60

    if (isRTU && !isTCP) {
      batchSize = 20
    }

    const variableInfoMap = new Map<number, VariableInfo[]>()

    // Helper to add a VariableInfo entry to the map, supporting multiple entries per debug index.
    // This is critical for global (external) variables that share a single debug index across programs.
    const addVariableInfo = (index: number, info: VariableInfo) => {
      const existing = variableInfoMap.get(index)
      if (existing) {
        const isDuplicate = existing.some((e) => e.pouName === info.pouName && e.variable.name === info.variable.name)
        if (!isDuplicate) {
          existing.push(info)
        }
      } else {
        variableInfoMap.set(index, [info])
      }
    }

    // Helper function to ensure ENO variable exists in FB variable list
    // ENO is always present in debug.c for function blocks but may not be in the type definition
    const ensureEnoVariable = (
      fbVars: Array<{ name: string; class: string; type: { definition: string; value: string } }>,
    ): Array<{ name: string; class: string; type: { definition: string; value: string } }> => {
      const hasEno = fbVars.some((v) => v.type.definition === 'base-type' && v.name.toUpperCase() === 'ENO')
      if (hasEno) return fbVars
      return [...fbVars, { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } }]
    }

    // Helper function to recursively process nested FB and struct variables
    const processNestedVariables = (
      fbVariables: Array<{ name: string; class: string; type: { definition: string; value: string } }>,
      pouName: string,
      debugPathPrefix: string,
      variableNamePrefix: string,
    ) => {
      fbVariables.forEach((fbVar) => {
        if (fbVar.type.definition === 'base-type') {
          // Base type variable - add to variableInfoMap
          const debugPath = `${debugPathPrefix}.${fbVar.name.toUpperCase()}`
          const index = debugVariableIndexes.get(debugPath)

          if (index === undefined) {
            console.warn(
              `[Debugger] Could not resolve index for nested variable: ${debugPathPrefix}.${fbVar.name} (POU: ${pouName})`,
            )
          }

          if (index !== undefined) {
            const varName = `${variableNamePrefix}.${fbVar.name}`
            addVariableInfo(index, {
              pouName,
              variable: {
                name: varName,
                type: {
                  definition: 'base-type',
                  value: fbVar.type.value.toLowerCase() as PLCBaseTypesLowercase,
                },
                class: 'local',
                location: '',
                documentation: '',
                debug: false,
              },
            })
          }
        } else if (fbVar.type.definition === 'derived') {
          // Nested function block - recursively process
          const nestedFBTypeName = fbVar.type.value.toUpperCase()
          const nestedDebugPath = `${debugPathPrefix}.${fbVar.name.toUpperCase()}`
          const nestedVarName = `${variableNamePrefix}.${fbVar.name}`

          // Look up the nested FB definition
          let nestedFBVariables:
            | Array<{ name: string; class: string; type: { definition: string; value: string } }>
            | undefined

          const standardFB = StandardFunctionBlocks.pous.find(
            (fb: { name: string }) => fb.name.toUpperCase() === nestedFBTypeName,
          )
          if (standardFB) {
            nestedFBVariables = ensureEnoVariable(standardFB.variables)
          } else {
            const customFB = project.data.pous.find(
              (p) => p.type === 'function-block' && p.data.name.toUpperCase() === nestedFBTypeName,
            )
            if (customFB && customFB.type === 'function-block') {
              nestedFBVariables = ensureEnoVariable(
                customFB.data.variables as Array<{
                  name: string
                  class: string
                  type: { definition: string; value: string }
                }>,
              )
            }
          }

          if (nestedFBVariables) {
            processNestedVariables(nestedFBVariables, pouName, nestedDebugPath, nestedVarName)
          }
        } else if (fbVar.type.definition === 'user-data-type') {
          // Nested struct - recursively process
          const structTypeName = fbVar.type.value
          const nestedDebugPath = `${debugPathPrefix}.${fbVar.name.toUpperCase()}`
          const nestedVarName = `${variableNamePrefix}.${fbVar.name}`

          // Check if this is actually a function block (some FBs are defined as user-data-type)
          const typeNameUpper = structTypeName.toUpperCase()
          const isStandardFB = StandardFunctionBlocks.pous.some(
            (pou: { name: string; type: string }) =>
              pou.name.toUpperCase() === typeNameUpper &&
              pou.type.toLowerCase().replace(/[-_]/g, '') === 'functionblock',
          )
          const isCustomFB = project.data.pous.some(
            (pou) => pou.type === 'function-block' && pou.data.name.toUpperCase() === typeNameUpper,
          )

          if (isStandardFB || isCustomFB) {
            // It's actually a function block
            let nestedFBVariables:
              | Array<{ name: string; class: string; type: { definition: string; value: string } }>
              | undefined

            const standardFB = StandardFunctionBlocks.pous.find(
              (fb: { name: string }) => fb.name.toUpperCase() === typeNameUpper,
            )
            if (standardFB) {
              nestedFBVariables = ensureEnoVariable(standardFB.variables)
            } else {
              const customFB = project.data.pous.find(
                (p) => p.type === 'function-block' && p.data.name.toUpperCase() === typeNameUpper,
              )
              if (customFB && customFB.type === 'function-block') {
                nestedFBVariables = ensureEnoVariable(
                  customFB.data.variables as Array<{
                    name: string
                    class: string
                    type: { definition: string; value: string }
                  }>,
                )
              }
            }

            if (nestedFBVariables) {
              processNestedVariables(nestedFBVariables, pouName, nestedDebugPath, nestedVarName)
            }
          } else {
            // It's a struct - look up the struct definition
            const structType = project.data.dataTypes.find((dt) => dt.name.toUpperCase() === typeNameUpper)

            if (structType && structType.derivation === 'structure') {
              const structVariables: Array<{
                name: string
                class: string
                type: { definition: string; value: string }
              }> = structType.variable.map((field) => ({
                name: field.name,
                class: 'local' as const,
                type: { definition: field.type.definition, value: field.type.value },
              }))
              processNestedVariables(structVariables, pouName, nestedDebugPath, nestedVarName)
            }
          }
        } else if (fbVar.type.definition === 'array') {
          const arrayType = fbVar.type as typeof fbVar.type & {
            data?: {
              baseType: { definition: string; value: string }
              dimensions: Array<{ dimension: string }>
            }
          }
          const range = parseDimensionRange(arrayType.data?.dimensions[0]?.dimension ?? '')
          const baseType = arrayType.data?.baseType
          const normalizedBaseType = baseType?.value.toLowerCase()

          if (
            !range ||
            baseType?.definition !== 'base-type' ||
            !normalizedBaseType ||
            !baseTypeSchema.safeParse(normalizedBaseType).success
          ) {
            console.warn(`[Debugger] Skipping unsupported array variable: ${variableNamePrefix}.${fbVar.name}`)
            return
          }

          for (let offset = 0; offset <= range.upper - range.lower; offset++) {
            const iecIndex = range.lower + offset
            const debugPath = `${debugPathPrefix}.${fbVar.name.toUpperCase()}.value.table[${offset}]`
            const index = debugVariableIndexes.get(debugPath)
            if (index === undefined) continue

            addVariableInfo(index, {
              pouName,
              variable: {
                name: `${variableNamePrefix}.${fbVar.name}[${iecIndex}]`,
                type: {
                  definition: 'base-type',
                  value: normalizedBaseType as PLCBaseTypesLowercase,
                },
                class: 'local',
                location: '',
                documentation: '',
                debug: false,
              },
            })
          }
        }
      })
    }

    project.data.pous.forEach((pou) => {
      if (pou.type !== 'program') return

      pou.data.variables.forEach((v) => {
        if (v.type.definition === 'array' && v.type.data.baseType.definition === 'base-type') {
          const range = parseDimensionRange(v.type.data.dimensions[0]?.dimension ?? '')
          if (!range) return

          for (let iecIndex = range.lower; iecIndex <= range.upper; iecIndex++) {
            const compositeKey = `${pou.data.name}:${v.name}[${iecIndex}]`
            const index = debugVariableIndexes.get(compositeKey)
            if (index === undefined) continue

            addVariableInfo(index, {
              pouName: pou.data.name,
              variable: {
                name: `${v.name}[${iecIndex}]`,
                type: {
                  definition: 'base-type',
                  value: v.type.data.baseType.value,
                },
                class: v.class,
                location: v.location,
                documentation: v.documentation,
                debug: v.debug,
              },
            })
          }
          return
        }

        const compositeKey = `${pou.data.name}:${v.name}`
        const index = debugVariableIndexes.get(compositeKey)
        if (index !== undefined) {
          addVariableInfo(index, { pouName: pou.data.name, variable: v })
        } else {
          console.warn(
            `[Debugger] Could not resolve index for program variable: ${compositeKey} (type: ${v.type.value})`,
          )
        }
      })
    })

    const { ladderFlows, fbdFlows } = useOpenPLCStore.getState()

    project.data.pous.forEach((pou) => {
      if (pou.type !== 'program') return

      const instances = project.data.configuration.resource.instances
      const programInstance = instances.find((inst) => inst.program === pou.data.name)

      if (programInstance) {
        const functionBlockInstances = pou.data.variables.filter((variable) => variable.type.definition === 'derived')

        const blockExecutionControlMap = new Map<string, boolean>()
        if (pou.data.body.language === 'ld') {
          const currentLadderFlow = ladderFlows.find((flow) => flow.name === pou.data.name)
          if (currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'block') {
                  const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
                  if (blockData.variable?.name && blockData.executionControl) {
                    blockExecutionControlMap.set(blockData.variable.name, true)
                  }
                }
              })
            })
          }
        } else if (pou.data.body.language === 'fbd') {
          const currentFbdFlow = fbdFlows.find((flow) => flow.name === pou.data.name)
          currentFbdFlow?.rung.nodes.forEach((node) => {
            if (node.type !== 'block') return
            const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
            if (blockData.variable?.name && blockData.executionControl) {
              blockExecutionControlMap.set(blockData.variable.name, true)
            }
          })
        }

        functionBlockInstances.forEach((fbInstance) => {
          const fbTypeName = fbInstance.type.value.toUpperCase()
          const hasExecutionControl = blockExecutionControlMap.get(fbInstance.name) || false

          let fbVariables:
            | Array<{ name: string; class: string; type: { definition: string; value: string } }>
            | undefined

          const standardFB = StandardFunctionBlocks.pous.find(
            (fb: { name: string }) => fb.name.toUpperCase() === fbTypeName,
          )
          if (standardFB) {
            fbVariables = standardFB.variables
          } else {
            const customFB = project.data.pous.find(
              (p) => p.type === 'function-block' && p.data.name.toUpperCase() === fbTypeName,
            )
            if (customFB && customFB.type === 'function-block') {
              fbVariables = customFB.data.variables as Array<{
                name: string
                class: string
                type: { definition: string; value: string }
              }>
            }
          }

          if (fbVariables) {
            let allBaseTypeVars = fbVariables.filter((v) => v.type.definition === 'base-type')

            if (hasExecutionControl) {
              const hasENO = allBaseTypeVars.some((v) => v.name.toUpperCase() === 'ENO')
              if (!hasENO) {
                allBaseTypeVars = [
                  ...allBaseTypeVars,
                  { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
                ]
              }
            }

            allBaseTypeVars.forEach((fbVar) => {
              const debugPath = `RES0__${programInstance.name.toUpperCase()}.${fbInstance.name.toUpperCase()}.${fbVar.name.toUpperCase()}`
              const index = debugVariableIndexes.get(debugPath)

              if (index !== undefined) {
                const blockVarName = `${fbInstance.name}.${fbVar.name}`
                addVariableInfo(index, {
                  pouName: pou.data.name,
                  variable: {
                    name: blockVarName,
                    type: {
                      definition: 'base-type',
                      value: fbVar.type.value.toLowerCase() as PLCBaseTypesLowercase,
                    },
                    class: 'local',
                    location: '',
                    documentation: '',
                    debug: false,
                  },
                })
              }
            })

            // Process nested FB, struct and array variables recursively
            const nestedVariables = fbVariables.filter(
              (v) =>
                v.type.definition === 'derived' ||
                v.type.definition === 'user-data-type' ||
                v.type.definition === 'array',
            )
            if (nestedVariables.length > 0) {
              const debugPathPrefix = `RES0__${programInstance.name.toUpperCase()}.${fbInstance.name.toUpperCase()}`
              const variableNamePrefix = fbInstance.name
              processNestedVariables(nestedVariables, pou.data.name, debugPathPrefix, variableNamePrefix)
            }
          }
        })

        // Process top-level user-data-type variables (structs and any unresolved FBs)
        const userDataTypeVars = pou.data.variables.filter((variable) => variable.type.definition === 'user-data-type')
        userDataTypeVars.forEach((udtVar) => {
          const typeNameUpper = udtVar.type.value.toUpperCase()

          const isStandardFB = StandardFunctionBlocks.pous.some(
            (fb: { name: string; type: string }) =>
              fb.name.toUpperCase() === typeNameUpper && fb.type.toLowerCase().replace(/[-_]/g, '') === 'functionblock',
          )
          const isCustomFB = project.data.pous.some(
            (p) => p.type === 'function-block' && p.data.name.toUpperCase() === typeNameUpper,
          )

          let variablesToProcess:
            | Array<{ name: string; class: string; type: { definition: string; value: string } }>
            | undefined

          if (isStandardFB || isCustomFB) {
            const standardFB = StandardFunctionBlocks.pous.find(
              (fb: { name: string }) => fb.name.toUpperCase() === typeNameUpper,
            )
            if (standardFB) {
              variablesToProcess = ensureEnoVariable(standardFB.variables)
            } else {
              const customFB = project.data.pous.find(
                (p) => p.type === 'function-block' && p.data.name.toUpperCase() === typeNameUpper,
              )
              if (customFB && customFB.type === 'function-block') {
                variablesToProcess = ensureEnoVariable(
                  customFB.data.variables as Array<{
                    name: string
                    class: string
                    type: { definition: string; value: string }
                  }>,
                )
              }
            }
          } else {
            const structType = project.data.dataTypes.find((dt) => dt.name.toUpperCase() === typeNameUpper)
            if (structType && structType.derivation === 'structure') {
              variablesToProcess = structType.variable.map((field) => ({
                name: field.name,
                class: 'local' as const,
                type: { definition: field.type.definition, value: field.type.value },
              }))
            }
          }

          if (variablesToProcess) {
            const debugPathPrefix = `RES0__${programInstance.name.toUpperCase()}.${udtVar.name.toUpperCase()}`
            const variableNamePrefix = udtVar.name
            processNestedVariables(variablesToProcess, pou.data.name, debugPathPrefix, variableNamePrefix)
          }
        })

        const registerFunctionTempOutputs = (nodes: Array<{ type?: string; data: object }>) => {
          nodes.forEach((node) => {
            if (node.type !== 'block') return

            const blockData = node.data as {
              variant?: {
                name: string
                type: string
                variables: Array<{ name: string; class: string; type: { definition: string; value: string } }>
              }
              numericId?: string
              executionControl?: boolean
            }
            if (!blockData.variant || blockData.variant.type !== 'function' || !blockData.numericId) return

            const blockName = blockData.variant.name.toUpperCase()
            let outputVariables = blockData.variant.variables.filter(
              (variable) => variable.class === 'output' || variable.class === 'inOut',
            )

            if (
              blockData.executionControl &&
              !outputVariables.some((variable) => variable.name.toUpperCase() === 'ENO')
            ) {
              outputVariables = [
                ...outputVariables,
                { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
              ]
            }

            outputVariables.forEach((outputVariable) => {
              const tempVarName = `_TMP_${blockName}${blockData.numericId}_${outputVariable.name}`
              const debugPath = `RES0__${programInstance.name.toUpperCase()}.${tempVarName.toUpperCase()}`
              const index = debugVariableIndexes.get(debugPath)
              if (index === undefined) return
              const generatedType = iecDebugMetadata?.variables
                .find((variable) => variable.legacy_index === index)
                ?.type.toLowerCase()
              const outputType =
                outputVariable.type.definition === 'base-type'
                  ? outputVariable.type.value.toLowerCase()
                  : generatedType
              if (!outputType || !baseTypeSchema.safeParse(outputType).success) return

              addVariableInfo(index, {
                pouName: pou.data.name,
                variable: {
                  name: tempVarName,
                  type: {
                    definition: 'base-type',
                    value: outputType as PLCBaseTypesLowercase,
                  },
                  class: 'local',
                  location: '',
                  documentation: '',
                  debug: false,
                },
              })
            })
          })
        }

        if (pou.data.body.language === 'ld') {
          ladderFlows
            .find((flow) => flow.name === pou.data.name)
            ?.rungs.forEach((rung) => registerFunctionTempOutputs(rung.nodes))
        } else if (pou.data.body.language === 'fbd') {
          const currentFbdFlow = fbdFlows.find((flow) => flow.name === pou.data.name)
          if (currentFbdFlow) registerFunctionTempOutputs(currentFbdFlow.rung.nodes)
        }
      }
    })

    // Central FB instance visitor that handles ALL variable types at arbitrary nesting depth
    // This is the unified entry point for processing FB instances, handling:
    // 1. Base-type variables of the FB
    // 2. Nested FB/struct variables (via processNestedVariables)
    // 3. Function temps in ladder (for functions with execution control)
    // 4. Recursive processing of nested FB instances
    const visitFbInstance = (
      fbPou: (typeof project.data.pous)[0],
      debugPathPrefix: string,
      variablePathPrefix: string,
      programPouName: string,
      _blockExecutionControlMap: Map<string, boolean>,
    ) => {
      if (fbPou.type !== 'function-block') return

      const fbVariables = fbPou.data.variables as Array<{
        name: string
        class: string
        type: { definition: string; value: string }
      }>

      // 1. Process base-type variables of this FB
      const baseTypeVars = fbVariables.filter((v) => v.type.definition === 'base-type')
      baseTypeVars.forEach((fbVar) => {
        const debugPath = `${debugPathPrefix}.${fbVar.name.toUpperCase()}`
        const index = debugVariableIndexes.get(debugPath)

        if (index !== undefined) {
          const varName = `${variablePathPrefix}.${fbVar.name}`
          addVariableInfo(index, {
            pouName: programPouName,
            variable: {
              name: varName,
              type: {
                definition: 'base-type',
                value: fbVar.type.value.toLowerCase() as PLCBaseTypesLowercase,
              },
              class: 'local',
              location: '',
              documentation: '',
              debug: false,
            },
          })
        }
      })

      // 2. Process nested FB, struct and array variables recursively
      const nestedVariables = fbVariables.filter(
        (v) =>
          v.type.definition === 'derived' || v.type.definition === 'user-data-type' || v.type.definition === 'array',
      )
      if (nestedVariables.length > 0) {
        processNestedVariables(nestedVariables, programPouName, debugPathPrefix, variablePathPrefix)
      }

      // 3. Process function temps in ladder (if this FB has a ladder body)
      if (fbPou.data.body.language === 'ld') {
        const fbLadderFlow = ladderFlows.find((flow) => flow.name === fbPou.data.name)
        if (fbLadderFlow) {
          // Build execution control map for blocks in this FB's ladder
          const fbBlockExecutionControlMap = new Map<string, boolean>()
          fbLadderFlow.rungs.forEach((rung) => {
            rung.nodes.forEach((node) => {
              if (node.type === 'block') {
                const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
                if (blockData.variable?.name && blockData.executionControl) {
                  fbBlockExecutionControlMap.set(blockData.variable.name, true)
                }
              }
            })
          })

          // Process function blocks in this FB's ladder flow
          fbLadderFlow.rungs.forEach((rung) => {
            rung.nodes.forEach((node) => {
              if (node.type !== 'block') return

              const blockData = node.data as {
                variable?: { name: string }
                variant?: {
                  name: string
                  type: string
                  variables: Array<{ name: string; class: string; type: { definition: string; value: string } }>
                }
                numericId?: string
                executionControl?: boolean
              }

              // Only process functions (not function blocks) for _TMP_ variables
              if (!blockData.variant || blockData.variant.type !== 'function') return

              const blockName = blockData.variant.name.toUpperCase()
              const numericId = blockData.numericId
              if (!numericId) return

              let outputVariables = blockData.variant.variables.filter(
                (variable) => variable.class === 'output' || variable.class === 'inOut',
              )

              // Add ENO if execution control is enabled
              const hasExecutionControl = blockData.executionControl || false
              if (hasExecutionControl) {
                const hasENO = outputVariables.some((variable) => variable.name.toUpperCase() === 'ENO')
                if (!hasENO) {
                  outputVariables = [
                    ...outputVariables,
                    { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
                  ]
                }
              }

              outputVariables.forEach((outputVar) => {
                // Debug path uses the full nested path:
                // RES0__INSTANCE0.FB_B0.FB_A0._TMP_EQ_STATE7415072_ENO
                const debugPath = `${debugPathPrefix}._TMP_${blockName}${numericId}_${outputVar.name.toUpperCase()}`
                const index = debugVariableIndexes.get(debugPath)

                if (index !== undefined) {
                  const generatedType = iecDebugMetadata?.variables
                    .find((variable) => variable.legacy_index === index)
                    ?.type.toLowerCase()
                  const outputType =
                    outputVar.type.definition === 'base-type' ? outputVar.type.value.toLowerCase() : generatedType
                  if (!outputType || !baseTypeSchema.safeParse(outputType).success) return
                  // Variable name includes the full nested path for composite key matching
                  const tempVarName = `${variablePathPrefix}._TMP_${blockName}${numericId}_${outputVar.name}`
                  addVariableInfo(index, {
                    pouName: programPouName,
                    variable: {
                      name: tempVarName,
                      type: {
                        definition: 'base-type',
                        value: outputType as PLCBaseTypesLowercase,
                      },
                      class: 'local',
                      location: '',
                      documentation: '',
                      debug: false,
                    },
                  })
                }
              })
            })
          })
        }
      }

      // 4. Recursively visit nested FB instances declared as variables
      // Note: Standard FBs (TON, TOF, etc.) are already handled by processNestedVariables above
      // Here we only recurse into custom (user-defined) FBs to process their internal ladder/FBD
      const nestedFbInstances = fbVariables.filter((v) => v.type.definition === 'derived')
      nestedFbInstances.forEach((nestedFbInstance) => {
        const nestedFbTypeName = nestedFbInstance.type.value.toUpperCase()

        // Only recurse into custom FBs (user-defined), not standard library FBs
        const customFB = project.data.pous.find(
          (p) => p.type === 'function-block' && p.data.name.toUpperCase() === nestedFbTypeName,
        )

        if (customFB && customFB.type === 'function-block') {
          // For custom FBs, recursively visit to process their internals
          const nestedDebugPathPrefix = `${debugPathPrefix}.${nestedFbInstance.name.toUpperCase()}`
          const nestedVariablePathPrefix = `${variablePathPrefix}.${nestedFbInstance.name}`
          visitFbInstance(customFB, nestedDebugPathPrefix, nestedVariablePathPrefix, programPouName, new Map())
        }
      })
    }

    // Start from program POUs and find all FB instances
    const instances = project.data.configuration.resource.instances
    project.data.pous.forEach((programPou) => {
      if (programPou.type !== 'program') return

      const programInstance = instances.find((inst) => inst.program === programPou.data.name)
      if (!programInstance) return

      // Build execution control map for blocks in this program's ladder
      const blockExecutionControlMap = new Map<string, boolean>()
      if (programPou.data.body.language === 'ld') {
        const currentLadderFlow = ladderFlows.find((flow) => flow.name === programPou.data.name)
        if (currentLadderFlow) {
          currentLadderFlow.rungs.forEach((rung) => {
            rung.nodes.forEach((node) => {
              if (node.type === 'block') {
                const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
                if (blockData.variable?.name && blockData.executionControl) {
                  blockExecutionControlMap.set(blockData.variable.name, true)
                }
              }
            })
          })
        }
      }

      // Find all FB instances in the program
      const fbInstances = programPou.data.variables.filter((v) => v.type.definition === 'derived')

      fbInstances.forEach((fbInstance) => {
        const fbTypeName = fbInstance.type.value.toUpperCase()

        // Check if it's a custom FB (user-defined)
        const customFB = project.data.pous.find(
          (p) => p.type === 'function-block' && p.data.name.toUpperCase() === fbTypeName,
        )

        if (customFB && customFB.type === 'function-block') {
          // For custom FBs, use visitFbInstance to process all internals
          const debugPathPrefix = `RES0__${programInstance.name.toUpperCase()}.${fbInstance.name.toUpperCase()}`
          const variablePathPrefix = fbInstance.name
          visitFbInstance(customFB, debugPathPrefix, variablePathPrefix, programPou.data.name, blockExecutionControlMap)
        }
      })
    })

    variableInfoMapRef.current = variableInfoMap

    // Extend debugVariableIndexes with composite keys from variableInfoMap
    // This enables force variable functionality for FB POUs by ensuring all
    // composite keys (like main:IRRIGATION_MAIN_CONTROLLER0.SENSOR_INPUT) are
    // mapped to their debug indexes. Without this, force handlers can't find
    // the index for FB variables because debugVariableIndexes only contains
    // program-level keys (like main:COUNTER) from the initial parsing.
    const { workspaceActions: wsActions } = useOpenPLCStore.getState()
    const updatedIndexes = new Map(debugVariableIndexes)
    variableInfoMap.forEach((varInfos, index) => {
      for (const varInfo of varInfos) {
        const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
        if (!updatedIndexes.has(compositeKey)) {
          updatedIndexes.set(compositeKey, index)
        }
      }
    })
    wsActions.setDebugVariableIndexes(updatedIndexes)

    const pollVariables = async () => {
      if (!pollingActive || !isMountedRef.current) return

      if (!variableInfoMapRef.current) {
        return
      }

      try {
        const { project: currentProject } = useOpenPLCStore.getState()

        const debugVariableKeys = new Set<string>()

        // Get FB debug context for function block POUs
        const {
          workspace: { fbSelectedInstance, fbDebugInstances },
        } = useOpenPLCStore.getState()

        currentProject.data.pous.forEach((pou) => {
          if (pou.type === 'program') {
            pou.data.variables
              .filter((v) => v.debug === true)
              .forEach((v) => {
                debugVariableKeys.add(`${pou.data.name}:${v.name}`)
              })
          } else if (pou.type === 'function-block') {
            // For function block POUs, transform variable keys using selected instance context
            const fbTypeKey = pou.data.name.toUpperCase() // Canonical key for map lookups
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (!selectedKey) return // No instance selected, skip

            // Find the instance info for the selected key
            const instances = fbDebugInstances.get(fbTypeKey) || []
            const selectedInstance = instances.find((inst) => inst.key === selectedKey)
            if (!selectedInstance) return // Instance not found, skip

            // Transform FB variable keys to use instance context
            // e.g., Calculate_PID:IN -> main:MOTOR_SPEED0.IN
            pou.data.variables
              .filter((v) => v.debug === true)
              .forEach((v) => {
                const transformedKey = `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${v.name}`
                debugVariableKeys.add(transformedKey)
              })
          }
        })

        // Get the current expansion state from the store
        const {
          workspace: { debugExpandedNodes },
        } = useOpenPLCStore.getState()

        // Helper function to check if a nested variable should be polled based on expansion state
        // A nested variable should be polled if:
        // 1. It's in the graph list (for real-time plotting), OR
        // 2. It has a watched ancestor AND all nodes from that ancestor to this variable are expanded
        // This supports arbitrary nesting depth - e.g., adding TON0 from within an FB POU
        // creates a watched key like main:IRRIGATION_MAIN_CONTROLLER0.TON0, and its children
        // (like ET, PT) should be polled when TON0 is expanded
        const shouldPollNestedVariable = (varName: string, pouName: string, currentGraphList: string[]): boolean => {
          // Fast-path: graphed variables must always be polled.
          const compositeKey = `${pouName}:${varName}`
          if (currentGraphList.includes(compositeKey)) {
            return true
          }

          if (debugVariableKeys.has(compositeKey)) {
            return true
          }

          const hierarchyPaths: string[] = []
          const dotParts = varName.split('.')
          let prefix = ''
          for (const part of dotParts) {
            const hasBracket = part.includes('[')
            if (hasBracket) {
              const base = part.split('[')[0]
              if (base) {
                const basePath = prefix ? `${prefix}.${base}` : base
                if (hierarchyPaths[hierarchyPaths.length - 1] !== basePath) {
                  hierarchyPaths.push(basePath)
                }
              }
            }

            const fullPath = prefix ? `${prefix}.${part}` : part
            hierarchyPaths.push(fullPath)
            prefix = fullPath
          }

          // If there's no hierarchy, treat as not pollable.
          if (hierarchyPaths.length === 0) {
            return false
          }

          // If this is not nested (single path, no bracket-derived parent), it must be explicitly watched/forced.
          // (This matches previous behavior for simple variables.)
          if (hierarchyPaths.length === 1) {
            return debugVariableKeys.has(`${pouName}:${hierarchyPaths[0]}`)
          }

          // Find the deepest watched ancestor in the hierarchy.
          let watchedAncestorPos = -1
          for (let i = hierarchyPaths.length - 2; i >= 0; i--) {
            const candidateKey = `${pouName}:${hierarchyPaths[i]}`
            if (debugVariableKeys.has(candidateKey)) {
              watchedAncestorPos = i
              break
            }
          }

          if (watchedAncestorPos === -1) {
            return false
          }

          // Ensure every ancestor from watched -> parent of target is expanded.
          // The target node itself does not need to be expanded to show its value.
          for (let i = watchedAncestorPos; i < hierarchyPaths.length - 1; i++) {
            const parentKey = `${pouName}:${hierarchyPaths[i]}`
            const isParentExpanded = debugExpandedNodes.get(parentKey) ?? false
            if (!isParentExpanded) {
              return false
            }
          }

          return true
        }

        // Add nested variables to polling based on expansion state
        // This now supports arbitrary nesting depth by finding the deepest watched ancestor
        Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfos]) => {
          for (const varInfo of varInfos) {
            // Treat both dot-nesting (A.B) and array indexing (A[1]) as nested.
            if (varInfo.variable.name.includes('.') || varInfo.variable.name.includes('[')) {
              const childKey = `${varInfo.pouName}:${varInfo.variable.name}`
              if (shouldPollNestedVariable(varInfo.variable.name, varInfo.pouName, graphListRef.current)) {
                debugVariableKeys.add(childKey)
              }
            }
          }
        })

        // Preserve user watches, plots and expanded debugger-tree values. The legacy graphical scan below is kept
        // temporarily for compatibility while the active graph is resolved, but its broad additions are replaced
        // by the dependency planner before the request is sent.
        const explicitDebugVariableKeys = new Set(debugVariableKeys)
        const graphicalDebugVariableKeys = new Set<string>()

        const { editor, ladderFlows } = useOpenPLCStore.getState()
        const currentPou = currentProject.data.pous.find((pou) => pou.data.name === editor.meta.name)

        // Helper to create composite key for current POU, handling FB instance context
        const makeCompositeKeyForCurrentPou = (variableName: string): string | null => {
          if (!currentPou) return null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (!selectedKey) return null
            const instances = fbDebugInstances.get(fbTypeKey) || []
            const selectedInstance = instances.find((inst) => inst.key === selectedKey)
            if (!selectedInstance) return null
            return `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${variableName}`
          }
          return `${currentPou.data.name}:${variableName}`
        }

        if (ENABLE_LEGACY_GRAPHICAL_WATCH_SCAN && currentPou && currentPou.data.body.language === 'ld') {
          const currentLadderFlow = ladderFlows.find((flow) => flow.name === editor.meta.name)
          if (currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'contact' || node.type === 'coil') {
                  const nodeData = node.data as {
                    variable?: { name?: string; type?: { definition?: string; value?: string } }
                  }
                  const variableName = nodeData.variable?.name

                  if (
                    variableName &&
                    nodeData.variable?.type?.definition === 'base-type' &&
                    nodeData.variable?.type?.value?.toUpperCase() === 'BOOL'
                  ) {
                    const compositeKey = makeCompositeKeyForCurrentPou(variableName)
                    if (compositeKey) {
                      debugVariableKeys.add(compositeKey)
                    }
                  }
                }
              })
            })
          }

          // Get FB instance context for function block POUs
          let fbInstanceCtx: { programName: string; fbVariableName: string } | null = null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (selectedKey) {
              const instances = fbDebugInstances.get(fbTypeKey) || []
              const selectedInstance = instances.find((inst) => inst.key === selectedKey)
              if (selectedInstance) {
                fbInstanceCtx = {
                  programName: selectedInstance.programName,
                  fbVariableName: selectedInstance.fbVariableName,
                }
              }
            }
          }

          // For FB POUs, poll nested FB variables using instance context
          // For program POUs, poll FB instance variables using the standard approach
          if (currentPou.type === 'function-block' && fbInstanceCtx) {
            // Poll all nested BOOL variables within the FB instance
            Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfos]) => {
              for (const varInfo of varInfos) {
                if (
                  varInfo.pouName === fbInstanceCtx.programName &&
                  varInfo.variable.name.startsWith(`${fbInstanceCtx.fbVariableName}.`) &&
                  varInfo.variable.type.definition === 'base-type' &&
                  varInfo.variable.type.value.toLowerCase() === 'bool'
                ) {
                  const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                  debugVariableKeys.add(compositeKey)
                }
              }
            })
          } else {
            const functionBlockInstances = currentPou.data.variables.filter(
              (variable) => variable.type.definition === 'derived',
            )

            functionBlockInstances.forEach((fbInstance) => {
              Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                for (const varInfo of varInfos) {
                  if (
                    varInfo.pouName === currentPou.data.name &&
                    varInfo.variable.name.startsWith(`${fbInstance.name}.`) &&
                    varInfo.variable.type.definition === 'base-type' &&
                    varInfo.variable.type.value.toLowerCase() === 'bool'
                  ) {
                    const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                    debugVariableKeys.add(compositeKey)
                  }
                }
              })
            })
          }

          // For FB POUs, poll function outputs using instance context
          // For program POUs, poll function outputs using the standard approach
          if (currentPou.type === 'function-block' && fbInstanceCtx && currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'block') {
                  const blockData = node.data as {
                    variant?: { type: string }
                    numericId?: string
                  }

                  if (blockData.variant?.type === 'function' && blockData.numericId) {
                    Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                      for (const varInfo of varInfos) {
                        if (
                          varInfo.pouName === fbInstanceCtx.programName &&
                          varInfo.variable.name.startsWith(`${fbInstanceCtx.fbVariableName}.`) &&
                          varInfo.variable.name.includes(blockData.numericId!)
                        ) {
                          const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                          debugVariableKeys.add(compositeKey)
                        }
                      }
                    })
                  }
                }
              })
            })
          } else {
            const instances = currentProject.data.configuration.resource.instances
            const programInstance = instances.find((inst) => inst.program === currentPou.data.name)
            if (programInstance && currentLadderFlow) {
              currentLadderFlow.rungs.forEach((rung) => {
                rung.nodes.forEach((node) => {
                  if (node.type === 'block') {
                    const blockData = node.data as {
                      variant?: { type: string }
                      numericId?: string
                    }

                    if (blockData.variant?.type === 'function' && blockData.numericId) {
                      Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                        for (const varInfo of varInfos) {
                          if (
                            varInfo.pouName === currentPou.data.name &&
                            varInfo.variable.name.includes(blockData.numericId!)
                          ) {
                            const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                            debugVariableKeys.add(compositeKey)
                          }
                        }
                      })
                    }
                  }
                })
              })
            }
          }
        }

        const { fbdFlows } = useOpenPLCStore.getState()
        if (ENABLE_LEGACY_GRAPHICAL_WATCH_SCAN && currentPou && currentPou.data.body.language === 'fbd') {
          const currentFbdFlow = fbdFlows.find((flow) => flow.name === editor.meta.name)
          if (currentFbdFlow) {
            currentFbdFlow.rung.nodes.forEach((node) => {
              if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
                const nodeData = node.data as {
                  variable?: { name?: string }
                }
                const variableName = nodeData.variable?.name

                if (variableName) {
                  const variable = currentPou.data.variables.find(
                    (v) => v.name.toLowerCase() === variableName.toLowerCase(),
                  )
                  if (variable && variable.type.value.toUpperCase() === 'BOOL') {
                    const compositeKey = makeCompositeKeyForCurrentPou(variableName)
                    if (compositeKey) {
                      debugVariableKeys.add(compositeKey)
                    }
                  }
                }
              }
            })
          }

          // Get FB instance context for function block POUs (FBD)
          let fbdFbInstanceCtx: { programName: string; fbVariableName: string } | null = null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (selectedKey) {
              const instances = fbDebugInstances.get(fbTypeKey) || []
              const selectedInstance = instances.find((inst) => inst.key === selectedKey)
              if (selectedInstance) {
                fbdFbInstanceCtx = {
                  programName: selectedInstance.programName,
                  fbVariableName: selectedInstance.fbVariableName,
                }
              }
            }
          }

          // For FB POUs, poll nested FB variables using instance context
          // For program POUs, poll FB instance variables using the standard approach
          if (currentPou.type === 'function-block' && fbdFbInstanceCtx) {
            // Poll all nested BOOL variables within the FB instance
            Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfos]) => {
              for (const varInfo of varInfos) {
                if (
                  varInfo.pouName === fbdFbInstanceCtx.programName &&
                  varInfo.variable.name.startsWith(`${fbdFbInstanceCtx.fbVariableName}.`) &&
                  varInfo.variable.type.definition === 'base-type' &&
                  varInfo.variable.type.value.toLowerCase() === 'bool'
                ) {
                  const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                  debugVariableKeys.add(compositeKey)
                }
              }
            })
          } else {
            const functionBlockInstances = currentPou.data.variables.filter(
              (variable) => variable.type.definition === 'derived',
            )

            functionBlockInstances.forEach((fbInstance) => {
              Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                for (const varInfo of varInfos) {
                  if (
                    varInfo.pouName === currentPou.data.name &&
                    varInfo.variable.name.startsWith(`${fbInstance.name}.`) &&
                    varInfo.variable.type.definition === 'base-type' &&
                    varInfo.variable.type.value.toLowerCase() === 'bool'
                  ) {
                    const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                    debugVariableKeys.add(compositeKey)
                  }
                }
              })
            })
          }

          // For FB POUs, poll function outputs using instance context
          // For program POUs, poll function outputs using the standard approach
          if (currentPou.type === 'function-block' && fbdFbInstanceCtx && currentFbdFlow) {
            currentFbdFlow.rung.nodes.forEach((node) => {
              if (node.type === 'block') {
                const blockData = node.data as {
                  variant?: { type: string }
                  numericId?: string
                }

                if (blockData.variant?.type === 'function' && blockData.numericId) {
                  Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                    for (const varInfo of varInfos) {
                      if (
                        varInfo.pouName === fbdFbInstanceCtx.programName &&
                        varInfo.variable.name.startsWith(`${fbdFbInstanceCtx.fbVariableName}.`) &&
                        varInfo.variable.name.includes(blockData.numericId!)
                      ) {
                        const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                        debugVariableKeys.add(compositeKey)
                      }
                    }
                  })
                }
              }
            })
          } else {
            const instances = currentProject.data.configuration.resource.instances
            const programInstance = instances.find((inst) => inst.program === currentPou.data.name)
            if (programInstance && currentFbdFlow) {
              currentFbdFlow.rung.nodes.forEach((node) => {
                if (node.type === 'block') {
                  const blockData = node.data as {
                    variant?: { type: string }
                    numericId?: string
                  }

                  if (blockData.variant?.type === 'function' && blockData.numericId) {
                    Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfos]) => {
                      for (const varInfo of varInfos) {
                        if (
                          varInfo.pouName === currentPou.data.name &&
                          varInfo.variable.name.includes(blockData.numericId!)
                        ) {
                          const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                          debugVariableKeys.add(compositeKey)
                        }
                      }
                    })
                  }
                }
              })
            }
          }
        }

        // The PC owns the graphical topology. Only request IEC values that are actually visible in the
        // active LD/FBD graph; no graph IDs or power-flow state are sent to the target firmware.
        if (currentPou && (currentPou.data.body.language === 'ld' || currentPou.data.body.language === 'fbd')) {
          const graphNodes =
            currentPou.data.body.language === 'ld'
              ? ladderFlows.find((flow) => flow.name === editor.meta.name)?.rungs.flatMap((rung) => rung.nodes) ?? []
              : fbdFlows.find((flow) => flow.name === editor.meta.name)?.rung.nodes ?? []
          const graphEdges =
            currentPou.data.body.language === 'ld'
              ? ladderFlows.find((flow) => flow.name === editor.meta.name)?.rungs.flatMap((rung) => rung.edges) ?? []
              : fbdFlows.find((flow) => flow.name === editor.meta.name)?.rung.edges ?? []
          const availableKeys = new Set<string>()
          variableInfoMapRef.current.forEach((varInfos) => {
            for (const varInfo of varInfos) availableKeys.add(`${varInfo.pouName}:${varInfo.variable.name}`)
          })

          const graphicalWatchKeys = collectGraphicalDebugWatchKeys({
            nodes: graphNodes,
            edges: graphEdges,
            makeCompositeKey: makeCompositeKeyForCurrentPou,
            availableKeys,
          })
          graphicalWatchKeys.forEach((compositeKey) => graphicalDebugVariableKeys.add(compositeKey))
        }

        debugVariableKeys.clear()
        explicitDebugVariableKeys.forEach((compositeKey) => debugVariableKeys.add(compositeKey))
        graphicalDebugVariableKeys.forEach((compositeKey) => debugVariableKeys.add(compositeKey))

        // A force operation must keep polling the affected value even if it is not otherwise watched.
        const {
          workspace: { debugForcedVariables: currentForcedVariables },
        } = useOpenPLCStore.getState()
        currentForcedVariables.forEach((_value, compositeKey) => debugVariableKeys.add(compositeKey))

        const allIndexes = Array.from(variableInfoMapRef.current.entries())
          .filter(([_, varInfos]) =>
            varInfos.some((varInfo) => {
              const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
              return debugVariableKeys.has(compositeKey)
            }),
          )
          .map(([index, _]) => index)
          .sort((a, b) => a - b)

        if (allIndexes.length === 0) {
          return
        }

        // Single-batch-per-cycle: use batchOffsetRef to track position across poll cycles
        // Values from previous batches persist because newValues starts as a copy of the current store
        const { workspace: currentWorkspace } = useOpenPLCStore.getState()
        const newValues = new Map<string, string>()
        const newUpdatedAt = new Map(currentWorkspace.debugVariableUpdatedAt)
        currentWorkspace.debugVariableValues.forEach((value: string, key: string) => {
          newValues.set(key, value)
        })

        // New STM32 debug firmware reads the watch list by stable variable ID in
        // one bounded Modbus request.  Keep the legacy index batch as a fallback
        // for old firmware and for registry entries not supported by format v1.
        if (currentWorkspace.iecDebugMetadata) {
          const descriptorByLegacyIndex = new Map(
            currentWorkspace.iecDebugMetadata.variables.map((variable) => [variable.legacy_index, variable]),
          )
          const encodedSize = (type: number): number => {
            if ([1, 2, 3, 17].includes(type)) return 1
            if ([4, 5, 18].includes(type)) return 2
            if ([6, 7, 10, 19].includes(type)) return 4
            if ([8, 9, 11, 12, 13, 14, 15, 20].includes(type)) return 8
            if (type === 16) return 127
            return 0
          }

          let stableOffset = batchOffsetRef.current
          if (stableOffset >= allIndexes.length) stableOffset = 0
          const stableBatch: Array<{ id: number; type: number; legacyIndex: number }> = []
          let responsePayloadSize = 1
          for (let index = stableOffset; index < allIndexes.length && stableBatch.length < 24; index++) {
            const legacyIndex = allIndexes[index]
            const descriptor = descriptorByLegacyIndex.get(legacyIndex)
            const valueSize = descriptor ? encodedSize(descriptor.type_code) : 0
            if (!descriptor || valueSize === 0 || responsePayloadSize + 9 + valueSize > 245) break
            stableBatch.push({ id: descriptor.id, type: descriptor.type_code, legacyIndex })
            responsePayloadSize += 9 + valueSize
          }

          if (stableBatch.length > 0) {
            const stableResult = await window.bridge.debuggerReadIecVariables(
              stableBatch.map(({ id, type }) => ({ id, type })),
            )
            if (!pollingActive) return
            if (!stableResult.success || !stableResult.data) {
              throw new Error(stableResult.error ?? 'Stable IEC watch read failed')
            }

            const requestById = new Map(stableBatch.map((variable) => [variable.id, variable]))
            const nextForcedVariables = new Map(currentWorkspace.debugForcedVariables)
            const sampledAt = Date.now()
            for (const valueResult of stableResult.data) {
              const request = requestById.get(valueResult.id)
              const varInfos = request ? variableInfoMapRef.current?.get(request.legacyIndex) : undefined
              if (!request || valueResult.type !== request.type || !varInfos || varInfos.length === 0) {
                throw new Error(`Invalid stable IEC watch response for variable ${valueResult.id}`)
              }

              const { value } = parseVariableValue(new Uint8Array(valueResult.value), 0, varInfos[0].variable)
              for (const varInfo of varInfos) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                newValues.set(compositeKey, value)
                newUpdatedAt.set(compositeKey, sampledAt)
                if (valueResult.forced) {
                  if (!nextForcedVariables.has(compositeKey)) nextForcedVariables.set(compositeKey, true)
                } else {
                  nextForcedVariables.delete(compositeKey)
                }
              }
            }

            batchOffsetRef.current = (stableOffset + stableResult.data.length) % allIndexes.length
            if (isMountedRef.current) {
              workspaceActions.setDebugVariableValues(newValues)
              workspaceActions.setDebugVariableUpdatedAt(newUpdatedAt)
              workspaceActions.setDebugForcedVariables(nextForcedVariables)
            }
            return
          }
        }

        let currentBatchSize = batchSize

        // Clamp batchOffset to valid range (handles list size changes between cycles)
        let batchOffset = batchOffsetRef.current
        if (batchOffset >= allIndexes.length) {
          batchOffset = 0
        }

        // Slice one batch from the current offset
        let batch = allIndexes.slice(batchOffset, batchOffset + currentBatchSize)

        // First request
        let result = await window.bridge.debuggerGetVariablesList(batch)
        if (!pollingActive) return

        // Handle ERROR_OUT_OF_MEMORY with retry (halve batch size, retry same offset)
        while (!result.success && result.error === 'ERROR_OUT_OF_MEMORY' && currentBatchSize > 2) {
          currentBatchSize = Math.max(2, Math.floor(currentBatchSize / 2))
          batch = allIndexes.slice(batchOffset, batchOffset + currentBatchSize)
          result = await window.bridge.debuggerGetVariablesList(batch)
        }

        if (!result.success) {
          if (result.needsReconnect) {
            const { consoleActions } = useOpenPLCStore.getState()
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Debugger connection lost: ${result.error || 'Unknown error'}. Attempting to reconnect...`,
            })
          }
          return
        }

        let itemsProcessed = 0

        if (result.data && result.lastIndex !== undefined && Array.isArray(result.data)) {
          const responseBuffer = new Uint8Array(result.data)
          let bufferOffset = 0
          const sampledAt = Date.now()

          for (const index of batch) {
            const varInfos = variableInfoMapRef.current?.get(index)
            if (!varInfos || varInfos.length === 0) {
              continue
            }

            // Use the first entry for parsing (all entries share the same debug index and type)
            const { variable } = varInfos[0]

            if (bufferOffset >= responseBuffer.length) {
              break
            }

            try {
              const { value, bytesRead } = parseVariableValue(responseBuffer, bufferOffset, variable)
              // Write the parsed value to ALL composite keys for this index.
              // This ensures global (external) variables display correctly in every program.
              for (const varInfo of varInfos) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                newValues.set(compositeKey, value)
                newUpdatedAt.set(compositeKey, sampledAt)
              }
              bufferOffset += bytesRead
            } catch {
              for (const varInfo of varInfos) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                newValues.set(compositeKey, 'ERR')
                newUpdatedAt.set(compositeKey, sampledAt)
              }
              bufferOffset += getVariableSize(variable)
            }

            itemsProcessed++

            if (index === result.lastIndex) {
              break
            }
          }
        }

        // Advance offset for next poll cycle (wraps around)
        if (itemsProcessed > 0) {
          batchOffsetRef.current = (batchOffset + itemsProcessed) % allIndexes.length
        }

        if (isMountedRef.current) {
          workspaceActions.setDebugVariableValues(newValues)
          workspaceActions.setDebugVariableUpdatedAt(newUpdatedAt)
        }
      } catch (error: unknown) {
        if (!pollingActive || !useOpenPLCStore.getState().workspace.isDebuggerVisible) return
        const { consoleActions } = useOpenPLCStore.getState()
        consoleActions.addLog({
          id: `debugger-poll-error-${Date.now()}`,
          level: 'error',
          message: `Debugger polling error: ${String(error)}`,
        })
      }
    }

    let isPolling = false
    // Fire first poll immediately
    isPolling = true
    void pollVariables().finally(() => {
      isPolling = false
    })
    // Schedule fixed-rate polling; skip tick if previous poll is still in progress
    pollingIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current || isPolling) return
      isPolling = true
      void pollVariables().finally(() => {
        isPolling = false
      })
    }, DEBUGGER_POLL_INTERVAL_MS)

    return () => {
      pollingActive = false
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      void window.bridge.debuggerDisconnect().catch((error: unknown) => {
        const { consoleActions } = useOpenPLCStore.getState()
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to disconnect debugger: ${String(error)}`,
        })
      })
    }
  }, [isDebuggerVisible])

  useEffect(() => {
    let logsPollingInterval: NodeJS.Timeout | null = null

    const pollLogs = async (): Promise<void> => {
      const {
        runtimeConnection: { connectionStatus, ipAddress, jwtToken, plcStatus },
        workspaceActions,
      } = useOpenPLCStore.getState()

      if (connectionStatus === 'connected') {
        workspaceActions.setPlcLogsVisible(true)
      } else {
        workspaceActions.setPlcLogsVisible(false)
        workspaceActions.setPlcLogs('')
        return
      }

      if (ipAddress && jwtToken && plcStatus === 'RUNNING') {
        try {
          const result = await window.bridge.runtimeGetLogs(ipAddress, jwtToken)
          if (result.success && result.logs !== undefined) {
            workspaceActions.setPlcLogs(result.logs)
          } else {
            console.error('Failed to fetch PLC logs:', result.error ?? 'Unknown error')
          }
        } catch (error: unknown) {
          console.error('Error polling PLC logs:', String(error))
        }
      }
    }

    void pollLogs()

    logsPollingInterval = setInterval(() => {
      void pollLogs()
    }, PLC_LOGS_POLL_INTERVAL_MS)

    return () => {
      if (logsPollingInterval) {
        clearInterval(logsPollingInterval)
      }
    }
  }, [])

  type PanelMethods = {
    collapse: () => void
    expand: () => void
  } & ImperativePanelHandle

  const panelRef = useRef<ImperativePanelHandle | null>(null)
  const explorerPanelRef = useRef<PanelMethods | null>(null)
  const workspacePanelRef = useRef<PanelMethods | null>(null)
  const consolePanelRef = useRef<PanelMethods | null>(null)
  const hasSearchResults = searchResults.length > 0

  const togglePanel = () => {
    if (panelRef.current) {
      panelRef.current.resize(25)
    }
  }

  useEffect(() => {
    if (hasSearchResults) {
      setActiveTab('search')
    } else {
      setActiveTab((prev) => (prev === 'search' ? 'console' : prev))
    }
  }, [hasSearchResults])

  useEffect(() => {
    if (!isDebuggerVisible) {
      setActiveTab((prev) => (prev === 'debug' ? 'console' : prev))
    }
  }, [isDebuggerVisible])

  useEffect(() => {
    if (!isPlcLogsVisible) {
      setActiveTab((prev) => (prev === 'plc-logs' ? 'console' : prev))
    }
  }, [isPlcLogsVisible])

  useEffect(() => {
    const action = isCollapsed ? 'collapse' : 'expand'
    ;[explorerPanelRef, workspacePanelRef, consolePanelRef].forEach((ref) => {
      if (ref.current && typeof ref.current[action] === 'function') {
        ref.current[action]()
      }
    })
  }, [isCollapsed])
  useEffect(() => {
    const getAvailableBoardOptions = async () => {
      const boards = await window.bridge.getAvailableBoards()
      setAvailableOptions({ availableBoards: boards })
    }
    void getAvailableBoardOptions()
  }, [])
  const [isSwitchingPerspective, setIsSwitchingPerspective] = useState(false)

  const handleSwitchPerspective = () => {
    if (!isSwitchingPerspective) {
      setIsSwitchingPerspective(true)
      toggleCollapse()
    }
  }

  useEffect(() => {
    window.bridge.switchPerspective((_event) => {
      handleSwitchPerspective()
    })
  }, [])

  useEffect(() => {
    const { deviceActions } = useOpenPLCStore.getState()
    const unsubscribe = window.bridge.onRuntimeTokenRefreshed((_event, newToken: string) => {
      deviceActions.setRuntimeJwtToken(newToken)
    }) as (() => void) | undefined

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleForceVariable = async (
    compositeKey: string,
    _variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ): Promise<void> => {
    const keyForIndexLookup = lookupKey ?? compositeKey
    const variableIndex = debugVariableIndexes.get(keyForIndexLookup)
    if (variableIndex === undefined) {
      console.warn(
        `[Debugger] Force variable failed: no index found for key "${keyForIndexLookup}" (compositeKey: "${compositeKey}")`,
      )
      return
    }

    const stableVariable = useOpenPLCStore
      .getState()
      .workspace.iecDebugMetadata?.variables.find((variable) => variable.legacy_index === variableIndex)

    if (value === undefined && valueBuffer === undefined) {
      // Release force
      const result = stableVariable
        ? await window.bridge.debuggerModifyIecVariable('unforce', stableVariable.id, stableVariable.type_code)
        : await window.bridge.debuggerSetVariable(variableIndex, false)
      if (result.success) {
        const newForcedVariables = new Map(Array.from(debugForcedVariables))
        newForcedVariables.delete(compositeKey)
        setDebugForcedVariables(newForcedVariables)
      }
    } else {
      // Set force - use valueBuffer for non-boolean types, fallback to boolean conversion
      const buffer = valueBuffer ?? new Uint8Array([value ? 1 : 0])
      const result = stableVariable
        ? await window.bridge.debuggerModifyIecVariable(
            'force',
            stableVariable.id,
            stableVariable.type_code,
            toNativeIecDebugValue(buffer, stableVariable.type_code),
          )
        : await window.bridge.debuggerSetVariable(variableIndex, true, buffer)
      if (result.success) {
        const newForcedVariables = new Map(Array.from(debugForcedVariables))
        newForcedVariables.set(compositeKey, value ?? true)
        setDebugForcedVariables(newForcedVariables)
      }
    }
  }

  const handleModifyVariable = async (
    compositeKey: string,
    _variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ): Promise<void> => {
    const variableIndex = debugVariableIndexes.get(lookupKey ?? compositeKey)
    const stableVariable = iecDebugMetadata?.variables.find((variable) => variable.legacy_index === variableIndex)
    if (variableIndex === undefined || !stableVariable) {
      console.warn(`[IEC Debugger] No stable writable variable found for ${lookupKey ?? compositeKey}`)
      return
    }

    const buffer = valueBuffer ?? new Uint8Array([value ? 1 : 0])
    const result = await window.bridge.debuggerModifyIecVariable(
      'write',
      stableVariable.id,
      stableVariable.type_code,
      toNativeIecDebugValue(buffer, stableVariable.type_code),
    )
    const { consoleActions } = useOpenPLCStore.getState()
    consoleActions.addLog({
      id: crypto.randomUUID(),
      level: result.success ? 'info' : 'error',
      message: result.success
        ? `Modified ${compositeKey}. The PLC program may overwrite this value in the next cycle.`
        : `Failed to modify ${compositeKey}: ${result.error ?? 'Unknown error'}`,
    })
  }
  return (
    <div className='flex h-full w-full bg-brand-dark dark:bg-neutral-950'>
      <AboutModal />
      <ConfirmDeviceSwitchModal />
      <RuntimeCreateUserModal />
      <RuntimeLoginModal />
      <DebuggerMessageModal />
      <DebuggerIpInputModal />
      <WorkspaceSideContent>
        <WorkspaceActivityBar
          defaultActivityBar={{
            zoom: {
              onClick: () => void toggleCollapse(),
            },
          }}
        />
      </WorkspaceSideContent>
      <WorkspaceMainContent>
        <ResizablePanelGroup
          id='mainContentPanelGroup'
          direction='horizontal'
          className='relative flex h-full w-full gap-2'
        >
          <Explorer collapse={explorerPanelRef} />

          <ResizablePanel
            ref={workspacePanelRef}
            id='workspacePanel'
            order={2}
            defaultSize={87}
            className='relative flex h-full w-[400px]'
          >
            <ResizableHandle
              id='workspaceHandle'
              hitAreaMargins={{ coarse: 3, fine: 3 }}
              className='absolute bottom-0 top-0 z-[99] my-[2px] w-[4px] py-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700  data-[resize-handle-state="hover"]:dark:bg-neutral-700'
            />
            <div id='workspaceContentPanel' className='flex h-full flex-1 grow flex-col gap-2 overflow-hidden'>
              {tabs.length > 0 && <Navigation />}
              <ResizablePanelGroup id='editorPanelGroup' className={`flex h-full gap-2`} direction='vertical'>
                <ResizablePanel
                  id='editorPanel'
                  order={1}
                  minSize={45}
                  defaultSize={75}
                  className={cn(
                    'relative  flex flex-1 grow flex-col overflow-hidden rounded-lg border-2 border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-neutral-950',
                    {
                      'py-0 pb-4': isVariablesPanelCollapsed,
                    },
                  )}
                >
                  {isVariablesPanelCollapsed && (
                    <div className='flex w-full justify-center'>
                      <button
                        className='flex w-auto items-center rounded-b-lg border-brand bg-neutral-50 px-2 py-1 dark:bg-neutral-900'
                        onClick={togglePanel}
                      >
                        <p className='text-xs font-medium text-brand-medium dark:text-brand-light'>Expand Table</p>
                        <ExitIcon
                          size='sm'
                          className='-rotate-90 select-none fill-brand-medium  stroke-brand dark:fill-brand-light dark:stroke-brand-light'
                        />
                      </button>
                    </div>
                  )}

                  {/**
                   * TODO: Need to be refactored.
                   * Must handle 3 types of editors: Textual editor, data type editor and graphical editor
                   */}
                  {tabs.length > 0 ? (
                    <>
                      {editor['type'] === 'plc-resource' && <ResourcesEditor />}
                      {editor['type'] === 'plc-device' && <DeviceEditor />}
                      {editor['type'] === 'plc-datatype' && <DataTypeEditor dataTypeName={editor.meta.name} />}
                      {(editor['type'] === 'plc-textual' || editor['type'] === 'plc-graphical') && (
                        <ResizablePanelGroup
                          id='editorContentPanelGroup'
                          direction='vertical'
                          className='flex flex-1 flex-col gap-1'
                        >
                          <ResizablePanel
                            ref={panelRef}
                            id='variableTablePanel'
                            order={1}
                            collapsible
                            onCollapse={() => {
                              setIsVariablesPanelCollapsed(true)
                            }}
                            onExpand={() => setIsVariablesPanelCollapsed(false)}
                            collapsedSize={0}
                            defaultSize={25}
                            minSize={20}
                            className={`relative flex h-full w-full flex-1 flex-col gap-4 overflow-auto`}
                          >
                            <VariablesEditor />
                          </ResizablePanel>

                          <ResizableHandle
                            style={{ height: '1px' }}
                            className={`${isVariablesPanelCollapsed && ' !hidden '}  flex  w-full bg-brand-light `}
                          />

                          <ResizablePanel
                            // onDrop={editor.type === 'plc-textual' ? handleDrop : undefined}
                            defaultSize={75}
                            id='textualEditorPanel'
                            order={2}
                            className='mt-4 flex-1 flex-grow rounded-md'
                          >
                            {editor['type'] === 'plc-textual' ? (
                              <MonacoEditor
                                name={editor.meta.name}
                                language={editor.meta.language}
                                path={editor.meta.path}
                              />
                            ) : (
                              <GraphicalEditor
                                name={editor.meta.name}
                                language={editor.meta.language}
                                path={editor.meta.path}
                              />
                            )}
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      )}
                      <ResizableHandle
                        id='consoleResizeHandle'
                        hitAreaMargins={{ coarse: 2, fine: 2 }}
                        style={{ height: '2px', width: 'calc(100% - 16px)' }}
                        className={`absolute bottom-0 left-0 mx-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700`}
                      />
                    </>
                  ) : (
                    <p className='mx-auto my-auto flex cursor-default select-none flex-col items-center gap-1 font-display text-xl font-medium'>
                      No tabs open
                    </p>
                  )}
                  <ResizableHandle
                    id='consoleResizeHandle'
                    hitAreaMargins={{ coarse: 2, fine: 2 }}
                    style={{ height: '2px', width: 'calc(100% - 16px)' }}
                    className={`absolute bottom-0 left-0 mx-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700`}
                  />
                </ResizablePanel>
                <ResizablePanel
                  ref={consolePanelRef}
                  id='consolePanel'
                  order={2}
                  collapsible
                  defaultSize={31}
                  minSize={22}
                  className='flex-1 grow  rounded-lg border-2 border-neutral-200 bg-white p-4 data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <Tabs.Root
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className='relative flex h-full w-full flex-col gap-2 overflow-hidden'
                  >
                    <Tabs.List className='flex h-7 w-64 select-none gap-4'>
                      <Tabs.Trigger
                        value='console'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                      >
                        Console
                      </Tabs.Trigger>
                      {isDebuggerVisible && (
                        <Tabs.Trigger
                          value='debug'
                          className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          Debugger
                        </Tabs.Trigger>
                      )}
                      {isPlcLogsVisible && (
                        <Tabs.Trigger
                          value='plc-logs'
                          className='h-7 w-20 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          PLC Logs
                        </Tabs.Trigger>
                      )}
                      {hasSearchResults && (
                        <Tabs.Trigger
                          value='search'
                          className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          Search
                        </Tabs.Trigger>
                      )}
                    </Tabs.List>
                    <Tabs.Content
                      aria-label='Console panel content'
                      value='console'
                      className='h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                    >
                      <ConsoleComponent />
                    </Tabs.Content>
                    {isDebuggerVisible && (
                      <Tabs.Content
                        value='debug'
                        className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full '>
                          <ResizablePanel minSize={15} defaultSize={20} className='h-full w-full'>
                            <VariablesPanel
                              variables={debugVariables}
                              variableTree={filteredDebugVariableTree}
                              graphList={graphList}
                              setGraphList={setGraphList}
                              debugVariableValues={debugVariableValues}
                              debugVariableIndexes={debugVariableIndexes}
                              debugForcedVariables={debugForcedVariables}
                              debugExpandedNodes={debugExpandedNodes}
                              onToggleExpandedNode={toggleDebugExpandedNode}
                              isDebuggerVisible={isDebuggerVisible}
                              onForceVariable={handleForceVariable}
                              onModifyVariable={iecDebugMetadata ? handleModifyVariable : undefined}
                            />
                          </ResizablePanel>
                          <ResizableHandle className='w-2 bg-transparent' />
                          <ResizablePanel minSize={20} defaultSize={80} className='h-full w-full'>
                            <Debugger graphList={graphList} />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </Tabs.Content>
                    )}
                    {isPlcLogsVisible && (
                      <Tabs.Content
                        aria-label='PLC Logs panel content'
                        value='plc-logs'
                        className='h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                      >
                        <PlcLogs />
                      </Tabs.Content>
                    )}
                    {hasSearchResults && (
                      <Tabs.Content
                        value='search'
                        className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full '>
                          <ResizablePanel minSize={20} defaultSize={100} className='h-full w-full'>
                            <Search items={searchResults} />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </Tabs.Content>
                    )}
                    {activeTab === 'console' && <ClearConsoleButton />}
                  </Tabs.Root>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </WorkspaceMainContent>
    </div>
  )
}

export { WorkspaceScreen }
