import type { IecDebugFrame, IecDebugMetadata, IecDebugStatus } from '@root/types/PLC/iec-debug'
import { PlcDebugSnapshot, plcDebugSnapshotSchema } from '@root/types/plc-operations/debug-observations'

import type { RootState } from '../store'

type State = Pick<RootState, 'workspace' | 'project' | 'deviceDefinitions'>
const clip = (value: string) => value.slice(0, 256)
const binding = (state: State) =>
  JSON.stringify([
    state.project.meta.path,
    state.deviceDefinitions.configuration.deviceBoard,
    state.workspace.debuggerTargetIp,
    state.deviceDefinitions.configuration.communicationPort,
    state.deviceDefinitions.configuration.runtimeIpAddress,
    state.deviceDefinitions.configuration.communicationConfiguration,
  ])
type Session = {
  binding: string
  startedAt: number
  status: PlcDebugSnapshot['status']
  callStack: PlcDebugSnapshot['callStack']
  localBuildId: string | null
  cacheLimited: boolean
  variables: Map<string, PlcDebugSnapshot['variables'][number]>
}

/** Separate, transient observation cache. Never writes the project/store or calls the PLC. */
export function createDebugObservations() {
  let current: Session | undefined
  const begin = (state: State, now = Date.now()): Session => {
    current = {
      binding: binding(state),
      startedAt: now,
      status: null,
      callStack: null,
      localBuildId: null,
      cacheLimited: false,
      variables: new Map(),
    }
    return current
  }
  const session = (state: State) => {
    if (!state.workspace.isDebuggerVisible || current?.binding !== binding(state)) current = undefined
    return current
  }
  const location = (frame: IecDebugFrame, metadata: IecDebugMetadata | null) => ({
    statementId: frame.statementId,
    pou: metadata?.pous.find((pou) => pou.id === frame.pouId)?.name.slice(0, 256) ?? null,
    instance: metadata?.instances.find((instance) => instance.id === frame.instanceId)?.path.slice(0, 256) ?? null,
    line:
      metadata?.statements.find((statement) => statement.id === frame.statementId && statement.pou_id === frame.pouId)
        ?.line ?? null,
  })
  return {
    begin,
    session,
    end: (token: Session) => {
      if (token === current) current = undefined
    },
    status: (token: Session | undefined, state: State, status: IecDebugStatus, now = Date.now()) => {
      if (!token || token !== session(state)) return
      if (status.state !== 1 || token.status?.haltCount !== status.haltCount) token.callStack = null
      token.localBuildId = state.workspace.iecDebugMetadata ? clip(state.workspace.iecDebugMetadata.build_id) : null
      token.status = {
        sampledAt: now,
        stateCode: status.state,
        haltCount: clip(status.haltCount),
        pointCount: clip(status.pointCount),
        location: location(
          { statementId: status.currentStatementId, pouId: status.currentPouId, instanceId: status.currentInstanceId },
          state.workspace.iecDebugMetadata,
        ),
      }
    },
    stack: (token: Session | undefined, state: State, stack: IecDebugFrame[], haltCount: string, now = Date.now()) => {
      if (!token || token !== session(state) || token.status?.stateCode !== 1 || token.status.haltCount !== haltCount)
        return
      token.callStack = {
        sampledAt: now,
        haltCount: clip(haltCount),
        frames: stack.slice(0, 32).map((frame) => location(frame, state.workspace.iecDebugMetadata)),
      }
    },
    values: (
      token: Session | undefined,
      state: State,
      values: Map<string, string>,
      timestamps: Map<string, number>,
      previous: Map<string, number>,
      forced?: Map<string, boolean>,
      sampledIndexes = state.workspace.debugVariableIndexes,
    ) => {
      if (!token || token !== session(state)) return
      for (const [key, sampledAt] of timestamps) {
        const index = sampledIndexes.get(key)
        if (
          index === undefined ||
          state.workspace.debugVariableIndexes.get(key) !== index ||
          sampledAt < token.startedAt ||
          previous.get(key) === sampledAt
        )
          continue
        token.variables.delete(key)
        token.variables.set(key, {
          key: clip(key),
          index,
          value: values.get(key)?.slice(0, 512) ?? null,
          sampledAt,
          forced: forced ? forced.has(key) : null,
        })
        if (token.variables.size > 256) {
          token.variables.delete(token.variables.keys().next().value!)
          token.cacheLimited = true
        }
      }
    },
    snapshot: (state: State, now = Date.now()): PlcDebugSnapshot => {
      const token = session(state)
      const watched = token
        ? [...state.workspace.debugVariableIndexes].filter(([key, index]) => token.variables.get(key)?.index === index)
        : []
      return plcDebugSnapshotSchema.parse({
        version: 1,
        capturedAt: now,
        debuggerActive: state.workspace.isDebuggerVisible,
        sessionMatches: !!token,
        target: state.workspace.isDebuggerVisible ? state.workspace.debuggerTargetIp?.slice(0, 256) ?? null : null,
        sourceMatch: 'unverified',
        unsavedChanges: state.workspace.editingState !== 'saved',
        localBuildId: token?.localBuildId ?? null,
        status: token?.status ?? null,
        callStack: token?.callStack ?? null,
        variables: watched.slice(0, 64).map(([key]) => token!.variables.get(key)),
        omittedVariables: Math.max(0, watched.length - 64),
        cacheLimited: token?.cacheLimited ?? false,
        selectedInstances: token
          ? [...state.workspace.fbSelectedInstance]
              .slice(0, 32)
              .map(([pou, instance]) => ({ pou: clip(pou), instance: clip(instance) }))
          : [],
      })
    },
  }
}

export const debugObservations = createDebugObservations()
