import type { DebugTreeNode, FbInstanceInfo } from '@root/types/debugger'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WorkspaceSlice } from './types'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'initial-state',
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
    recent: [],
    isCollapsed: false,
    isModalOpen: [],
    discardChanges: false,
    isDebuggerVisible: false,
    debuggerTargetIp: null,
    debugVariableIndexes: new Map(),
    debugVariableValues: new Map(),
    debugForcedVariables: new Map(),
    debugVariableTree: new Map(),
    debugExpandedNodes: new Map(),
    fbDebugInstances: new Map(),
    fbSelectedInstance: new Map(),
    iecDebugMetadata: null,
    iecDebugStatus: null,
    iecDebugCapabilities: 0,
    iecDebugCallStack: [],
    iecDebugBreakpoints: new Set(),
    isPlcLogsVisible: false,
    plcLogs: '',
    close: {
      window: false,
      app: false,
      appDarwin: false,
    },
    selectedProjectTreeLeaf: {
      label: '',
      type: null,
    },
  },

  workspaceActions: {
    setEditingState: (editingState): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = editingState
        }),
      )
    },
    setSystemConfigs: (systemConfigsData): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs = systemConfigsData
        }),
      )
    },
    setRecent: (recent): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.recent = recent
        }),
      )
    },
    setCloseApp: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.app = value
        }),
      )
    },
    setCloseAppDarwin: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.appDarwin = value
        }),
      )
    },
    setCloseWindow: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.window = value
        }),
      )
    },

    switchAppTheme: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.shouldUseDarkMode = !workspace.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    toggleMaximizedWindow: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.isWindowMaximized = !workspace.systemConfigs.isWindowMaximized
        }),
      )
    },
    toggleCollapse: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isCollapsed = !workspace.isCollapsed
        }),
      )
    },
    toggleDiscardChanges: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.discardChanges = !workspace.discardChanges
        }),
      )
    },
    setModalOpen: (modalName: string, modalState: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const modalIndex = workspace.isModalOpen.findIndex((modal) => modal.modalName === modalName)

          if (modalIndex !== -1) {
            workspace.isModalOpen[modalIndex].modalState = modalState
          } else {
            workspace.isModalOpen.push({ modalName, modalState })
          }
        }),
      )
    },
    setSelectedProjectTreeLeaf: (selectedProjectTreeLeaf): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.selectedProjectTreeLeaf = selectedProjectTreeLeaf
        }),
      )
    },
    clearWorkspace: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = 'initial-state'
          workspace.selectedProjectTreeLeaf = {
            label: '',
            type: null,
          }
        }),
      )
    },
    setDebuggerVisible: (isVisible: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isDebuggerVisible = isVisible
          if (!isVisible) {
            workspace.iecDebugMetadata = null
            workspace.iecDebugStatus = null
            workspace.iecDebugCapabilities = 0
            workspace.iecDebugCallStack = []
            workspace.iecDebugBreakpoints = new Set()
          }
        }),
      )
    },
    setDebuggerTargetIp: (targetIp: string | null): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debuggerTargetIp = targetIp
        }),
      )
    },
    setDebugVariableIndexes: (indexes: Map<string, number>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableIndexes = indexes
        }),
      )
    },
    setDebugVariableValues: (values: Map<string, string>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableValues = values
        }),
      )
    },
    setDebugForcedVariables: (forced: Map<string, boolean>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugForcedVariables = forced
        }),
      )
    },
    setDebugVariableTree: (tree: Map<string, DebugTreeNode>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableTree = tree
        }),
      )
    },
    setDebugExpandedNodes: (expandedNodes: Map<string, boolean>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugExpandedNodes = expandedNodes
        }),
      )
    },
    toggleDebugExpandedNode: (compositeKey: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const currentValue = workspace.debugExpandedNodes.get(compositeKey) ?? false
          workspace.debugExpandedNodes.set(compositeKey, !currentValue)
        }),
      )
    },
    setFbDebugInstances: (instances: Map<string, FbInstanceInfo[]>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = instances
        }),
      )
    },
    setFbSelectedInstance: (fbTypeName: string, key: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbSelectedInstance.set(fbTypeName, key)
        }),
      )
    },
    clearFbDebugContext: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = new Map()
          workspace.fbSelectedInstance = new Map()
        }),
      )
    },
    setIecDebugMetadata: (metadata): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.iecDebugMetadata = metadata
        }),
      )
    },
    setIecDebugStatus: (status): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.iecDebugStatus = status
        }),
      )
    },
    setIecDebugCapabilities: (capabilities): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.iecDebugCapabilities = capabilities
        }),
      )
    },
    setIecDebugCallStack: (callStack): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.iecDebugCallStack = callStack
        }),
      )
    },
    setIecDebugBreakpoints: (breakpoints): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.iecDebugBreakpoints = breakpoints
        }),
      )
    },
    removeDebugVariable: (compositeKey: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableIndexes.delete(compositeKey)
          workspace.debugVariableValues.delete(compositeKey)
          workspace.debugForcedVariables.delete(compositeKey)
          workspace.debugVariableTree.delete(compositeKey)
          workspace.debugExpandedNodes.delete(compositeKey)
        }),
      )
    },
    setPlcLogsVisible: (isVisible: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isPlcLogsVisible = isVisible
        }),
      )
    },
    setPlcLogs: (logs: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogs = logs
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
