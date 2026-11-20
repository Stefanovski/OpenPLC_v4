import type { CodexBuildAction } from './codex-chat'
import type { CodexContextAttachment } from './codex-context'
import type { CodexDebugSnapshot } from './codex-debug'
import type { CodexDebugAction } from './codex-debug-control'
import type { CodexProposal } from './codex-edits'

export type CodexAccount = { type: 'chatgpt' | 'apiKey'; email?: string; plan?: string }
export type CodexModel = { id: string; name: string; isDefault: boolean }
export type CodexMessage = {
  debugAction?: CodexDebugAction
  applyRequestId?: string
  id: string
  role: 'user' | 'assistant'
  text: string
  context?: { capturedAt: number; name: string; pous: number; ioStatus: string }
  debugger?: { capturedAt: number; variables: number; statusFreshness: string }
  proposal?: CodexProposal
  scratchOnly?: boolean
  buildAction?: CodexBuildAction
}
export type CodexState = {
  revision: number
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  account: CodexAccount | null
  loginPending: boolean
  operationPending: boolean
  models: CodexModel[]
  projectPath: string | null
  messages: CodexMessage[]
  busy: boolean
  error: string | null
}
export type CodexResult = { success: boolean; state: CodexState; error?: string }
export type CodexSendRequest = {
  debugRequestId?: string
  debugFollowup?: boolean
  applyRequestId?: string
  buildRequestId?: string
  projectPath: string
  text: string
  model: string
  context?: CodexContextAttachment
  debugger?: CodexDebugSnapshot
  proposeChanges?: boolean
  scratchOnly?: boolean
}
export type CodexAction =
  | 'connect'
  | 'sign-in'
  | 'cancel-login'
  | 'reopen-login'
  | 'sign-out'
  | 'disconnect'
  | 'stop'
  | 'new-chat'

export const initialCodexState = (): CodexState => ({
  revision: 0,
  connection: 'disconnected',
  account: null,
  loginPending: false,
  operationPending: false,
  models: [],
  projectPath: null,
  messages: [],
  busy: false,
  error: null,
})
