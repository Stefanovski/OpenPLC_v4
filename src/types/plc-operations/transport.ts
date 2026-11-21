import type { PlcBuildRequest, PlcBuildResult } from './build'
import type { PlcDebugExecute, PlcDebugResult } from './debugger'

/** Trusted editor transport; callers never receive arbitrary filesystem, shell or download access. */
export interface PlcOperationTransport {
  compile(request: PlcBuildRequest): Promise<PlcBuildResult>
  debugExecute(request: PlcDebugExecute): Promise<PlcDebugResult>
  debugClose(): Promise<void>
}
