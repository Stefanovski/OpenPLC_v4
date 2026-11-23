# Provider-independent OpenPLC operations

These shared operations support multiple AI adapters. The existing Codex sidebar,
runtime profile and IPC channel names remain compatible. An opt-in local
[MCP adapter](mcp-integration.md) now exposes these operations through shared-settings-controlled
editor requests; account login and provider selection remain separate concerns.

## Boundaries

| Layer | Location | Responsibility |
| --- | --- | --- |
| Shared contracts | `src/types/plc-operations/` | Bounded schemas for context, changes, compilation, observations and debug commands/results; trusted transport interface |
| Editor operations | `src/renderer/operations/` | Current unsaved context, validated change transactions and undo, isolated compile/repair orchestration, target/source guards, debugger UI lifecycle |
| Native operations | `src/main/services/plc-operations/` | Temporary compile-only builds, source verification, owned Modbus connection and common compiler/debugger exclusion |
| Codex adapter | Existing `codex` services, IPC contracts, hooks and dispatchers | Account/runtime, chat protocol, model selection, structured response format, prompt instructions, request/replay validation and completion analysis |

The dependency points from provider adapters to shared operations. The shared
modules do not import Codex, Claude, OpenAI/Anthropic SDKs, provider IPC contracts,
Electron IPC or `window.bridge`. Editor modules still intentionally depend on the
OpenPLC store and its existing editor/compiler data structures. They are not a
standalone service that operates only on saved files.

Compatibility modules retain established Codex exports. They delegate to the
same implementation rather than maintaining duplicate algorithms. In particular,
the ordinary debugger and the adapter share one observation-cache singleton.
The shared editor activity flag is `workspace.plcOperationsDebuggerActive`; this
is transient workspace state, not a new PLC project field.

## Editor entry points

Import pure operations from `src/renderer/operations/index.ts`:

- `buildPlcContext`: allowlisted unsaved project/device/IO snapshot. Freshness,
  generator guidance and unknown/mismatched hardware handling remain unchanged.
- `preparePlcChanges` / `preparePlcUndo`: validate and prepare complete atomic store
  patches. They do not save or download.
- `createPlcEditController`: applies those patches through an injected store port,
  records outcomes and retains the latest guarded undo. It accepts a transaction
  ID and proposal, without requiring a chat message, account or model.
- `preparePlcBuild` / `runPlcBuild`: capture current buffers and run the bounded
  detached compile/repair workflow. The provider supplies a repair callback; the
  result remains a proposal for review, not an automatically applied correction.
- `debuggerTarget`, `debugTargetKey`, `guardDebugAction`: source/target and ordinary
  debugger checks. The target comes from the editor, never from model output.
- `createDebugObservations` / `debugObservations`: bounded passive samples from the
  existing pollers, with no extra hardware reads.

`src/renderer/operations/use-debugger.ts` separately exports `usePlcDebugger`, the
React editor integration. Its injected transport supplies debug execute/close;
the hook retains execution confirmation, session binding, cancellation, the
activity lock and invalidation on source/target/project changes. Changing the
transport invalidates pending work. `useCodexDebugger` only adapts Codex request
data, the existing IPC bridge and the model-specific result-analysis callback.

## Main-process ownership

`MainProcessBridge` owns one `PlcOperationsService` per editor window and injects
it into the Codex IPC adapter. This service owns the shared build/debugger ports
and active project binding. A future provider must use that same instance;
creating one service per provider would bypass the shared concurrency guards.

- `compile`: refuses while the operations debugger is active and delegates to
  the isolated compile-only service.
- `executeDebug`: checks the current project, installed Eurosonic board and build
  activity, rechecks them across asynchronous validation, then delegates to the
  source-verified debugger.
- `debugContext`: returns the bounded result used for follow-up analysis.
- `selectProject`, `closeDebugger`, `dispose`: invalidate pending work and release
  only the owned connection. They never clear breakpoints or resume a halted PLC.

IO inventory already uses provider-independent `scanIoInventory` and the shared
IO contracts. Its existing `device:io-inventory` entry point and busy guard remain
unchanged; no provider-specific copy was introduced.

## Safeguards and future adapters

This is an internal trusted editor API, not an unauthenticated remote tool API.
Adapters must preserve the existing boundary between a model response and an
authorized editor operation:

1. Bind actions to a locally initiated request and current project/target. Reject
   incomplete, failed, cancelled, stale and replayed responses.
2. Pass changes through the editor transactions. Never implement a parallel file
   writer that overwrites unsaved buffers or bypasses guarded undo.
3. Keep compilation an explicit user request. Debugger failures and automatic
   analysis follow-ups must not start compile/repair or downloads.
4. Keep debugger execution confirmation in the host UI. `confirmExecution` is a
   trusted host decision and is absent from the model's command schema; never
   accept it as a model-supplied authorization.
5. Use the common activity/session guards. Source/metadata/live MD5 matching,
   firmware capabilities and known statement/variable IDs are still validated.
6. Keep provider credentials and SDK objects out of project context and operation
   contracts. No shell, arbitrary file access, force/write or PLC download was
   added to this interface.

The MCP adapter wraps these operations and their host authorization flow. Provider
login, chat and response adapters remain separate work. Neither the refactor nor
the MCP server adds a Claude Code selector inside the Codex sidebar.

## Verification

The existing Codex tests continue to run against compatibility adapters and the
extracted implementations. Additional tests exercise edits/undo and repair through
the neutral API without Codex messages/accounts/models, stale competing requests,
shared compiler/debugger exclusion, asynchronous cancellation/project changes,
and the absence of provider dependencies in shared modules. Editor acceptance
must also cover the original direct-edit, undo, chat compilation and active-debug
flows using disposable projects and simulated provider/PLC replies.

Validated on 2026-11-20, based on development `33a16ae45`:

- `npx jest --runInBand --no-coverage`: 68 suites, 570 tests passed.
- `npx tsc --noEmit --skipLibCheck`: passed; ESLint on changed TypeScript files
  passed, and the final focused checks reported no warnings.
- `npm run build`: main and renderer production builds passed.
- Electron direct-edit acceptance: ST/C++ creation, updates, instances, undo,
  review mode, replay/cancel/stale rejection, later-work protection and opt-out
  passed; original project files remained byte-identical.
- Electron active-debug acceptance: connect/observe, explicit step confirmation,
  breakpoint dismissal, analysis-only follow-up, activity/source/target guards,
  disconnect and opt-out passed with simulated model/PLC responses. No compiler
  or PLC download was invoked by this test.
- Electron chat-build acceptance: actual native ST/C++ compilation and linker
  diagnostics, simulated model corrections, successful final 5248-byte PLC
  binary, review/apply/undo, cancellation and stale/replayed request rejection
  passed. Original files and unsaved work were preserved; no hardware download.

These acceptance runs use an isolated Electron profile and disposable projects.
They do not constitute a new live account-login or physical PLC test.
