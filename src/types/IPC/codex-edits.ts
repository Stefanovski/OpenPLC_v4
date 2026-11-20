/** Compatibility exports; implementation belongs to the provider-independent PLC operations. */
export {
  type PlcEditReply as CodexEditReply,
  plcEditReplySchema as codexEditReplySchema,
  plcPouChangeSchema as codexPouChangeSchema,
  type PlcProposal as CodexProposal,
  parsePlcEditReply as parseCodexEditReply,
} from '../plc-operations/edits'

// Native app-server 0.157 TurnStartParams.outputSchema constrains the final message.
// All fields are required; no generic file operations or arbitrary RPC are exposed.
export const codexEditOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'changes', 'instances'],
  properties: {
    message: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'name', 'kind', 'language', 'returnType', 'documentation', 'declarations', 'body'],
        properties: {
          operation: { type: 'string', enum: ['create', 'update'] },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['program', 'function-block', 'function'] },
          language: { type: 'string', enum: ['st', 'cpp'] },
          returnType: { type: 'string' },
          documentation: { type: 'string' },
          declarations: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
    instances: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'task', 'program'],
        properties: { name: { type: 'string' }, task: { type: 'string' }, program: { type: 'string' } },
      },
    },
  },
}

export function getCodexEditInstructions(direct = false) {
  return codexEditInstructions.replace(
    'Proposals are NOT applied until the user reviews and applies them in OpenPLC.',
    direct
      ? 'DIRECT EDIT MODE: the host automatically applies complete, validated changes requested by the user to unsaved editor buffers after this turn. Return actual changes/instances, not just code snippets or instructions to edit manually. Questions and explanations still require empty changes/instances. The host can reject stale or unsafe edits and displays the actual outcome with Undo. Explain what you are submitting, without claiming success before host validation. No separate review click is needed in this mode.'
      : 'Proposals are NOT applied until the user reviews and applies them in OpenPLC.',
  )
}

export const codexEditInstructions = `Return the final answer using the supplied JSON schema. message is your explanation in the user's language. For questions return changes=[] and instances=[]. Only propose edits explicitly requested by the user. Resolve follow-ups such as "Bitte ändern" using the preceding conversation and the newest project snapshot. Return complete structured changes for an actionable edit request, not merely a snippet in message. Proposals are NOT applied until the user reviews and applies them in OpenPLC. Never claim you have already changed, saved, compiled or downloaded anything.
Supported: create/update ST programs, ST function blocks, ST functions; C++ function blocks only on eurosonic-cli. C++ programs are unsupported: propose a C++ FB plus ST calling program instead. Provide complete replacement declarations and body for each changed POU, preserving all unrelated code. No rename/delete/language conversion, global-variable edits, datatype edits, existing task/instance changes, interface refactoring or IO address rewrites.
Use the exact existing POU name for updates. kind and language must remain the same. Keep existing input/output/IN_OUT interfaces, function return types and located variable bindings intact. Use returnType only for ST functions, otherwise an empty string. Preserve pending raw declarations from the latest snapshot. Declarations must use complete VAR/VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT/VAR_EXTERNAL/VAR_TEMP blocks, one declaration per line with a semicolon and END_VAR on its own line. Only inline IEC comments on declarations are supported. Bodies contain no outer PROGRAM/FUNCTION_BLOCK/FUNCTION wrappers. C++ needs void setup() and void loop(); headers precede them. No invented APIs or hardware mappings.
instances adds NEW program instances to EXISTING tasks only, with exact task/program names. Never schedule a second instance of an already scheduled program. Do not invent a task interval. A new program is unscheduled unless a new instance is proposed; explain this. A new FB is usable from ST/FBD/LD once applied. Maximum 8 POU changes, 8 instances and 160 KB per proposal. If context is incomplete or a request requires unsupported refactoring, explain and ask rather than supplying a destructive replacement.`
