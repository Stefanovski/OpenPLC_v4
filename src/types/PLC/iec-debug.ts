export type IecDebugPou = {
  id: number
  key: string
  name: string
  kind: string
}

export type IecDebugStatement = {
  id: number
  pou_id: number
  key: string
  file: string
  line: number
  column: number
  end_line: number
  end_column: number
  type: string
}

export type IecDebugVariable = {
  id: number
  key: string
  name: string
  type: string
  type_code: number
  legacy_index: number
  writable: boolean
  instance_id: number
  path: string
}

export type IecDebugInstance = {
  id: number
  key: string
  name: string
  path: string
  source_path: string
  pou_id: number
  parent_id: number
  kind: 'program' | 'function-block'
}

export type IecGraphicalDebugBinding = {
  pou_id: number
  language: 'fbd' | 'ld'
  node_id: string
  local_id: string
  rung_id?: string
  kind: 'block' | 'output-variable' | 'coil'
  statement_ids: number[]
  breakpoint_statement_id: number
  source_line: number
}

export type IecDebugMetadata = {
  format: 'eurosonic-plc-debug'
  version: 1
  id_algorithm: 'fnv1a32'
  build_id: string
  pous: IecDebugPou[]
  statements: IecDebugStatement[]
  variables: IecDebugVariable[]
  instances: IecDebugInstance[]
  graphical_bindings?: IecGraphicalDebugBinding[]
}

export type IecDebugStatus = {
  state: number
  currentStatementId: number
  currentPouId: number
  currentInstanceId: number
  breakpointCount: number
  breakpointCapacity: number
  pointCount: string
  haltCount: string
}

export type IecDebugVariableValue = {
  forced: boolean
  type: number
  value: number[]
}

export type IecDebugVariableRequest = {
  id: number
  type: number
}

export type IecDebugVariableBatchValue = IecDebugVariableValue & {
  id: number
}

export type IecDebugFrame = {
  pouId: number
  instanceId: number
  statementId: number
}

export type IecDebugResumeMode = 'continue' | 'step-into' | 'step-over' | 'step-out'

export type IecDebugConditionOperator = '==' | '!=' | '>' | '>=' | '<' | '<='

export type IecDebugBreakpoint = {
  statementId: number
  instanceId?: number
  condition?: {
    variableId: number
    type: number
    operator: IecDebugConditionOperator
    value: number[]
  }
  change?: {
    variableId: number
    type: number
    size: number
  }
  hitTarget?: number
}

export type IecDebugResponse<T = void> = {
  success: boolean
  data?: T
  error?: string
}
