/** Editor-side public operations. Provider adapters supply transport, authorization and repair callbacks. */
export { preparePlcBuild, preparePlcProjectData, runPlcBuild } from './build'
export { buildPlcContext } from './context'
export { createDebugObservations, debugObservations } from './debug-observations'
export { debuggerTarget, debugTargetKey, guardDebugAction } from './debug-target'
export { createPlcEditController, type PlcEditOutcome, type PlcEditRequest } from './edit-controller'
export { contentKey, type PlcUndo, preparePlcChanges, preparePlcUndo } from './edits'
