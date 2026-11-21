# Local Codex integration

The underlying project, edit/undo, compile/repair and debugger operations now live
in provider-independent modules. Codex retains its account/chat protocol and
delegates through compatibility adapters. See [PLC operations](plc-operations.md)
for the boundaries, shared guards and requirements for provider adapters.

An optional [local MCP server](mcp-integration.md) is now available for external
clients. It uses separate host-reviewed requests and shared operations; the Codex
account/chat integration continues through its existing adapter. Debugger sessions
are owned by their adapter, so MCP and Codex cannot take over each other's session.

## Current scope

The docked sidebar supports browser sign-in, account status, model selection,
text conversations, streamed answers, Stop, New chat, Disconnect and Sign out.
Closing the sidebar preserves draft and conversation. Closing/switching projects
clears them and interrupts a pending answer. Editor components and unsaved PLC
buffers remain mounted. Enter adds a newline; Ctrl/Cmd+Enter sends.

This stage supports conversation with optional project context and direct or reviewed edits.
The enabled-by-default checkbox attaches a new snapshot when sending; Preview
project context shows the same projection without contacting Codex or hardware.
ST programs/functions/function blocks and Eurosonic C++ function blocks can be
created or updated through validated transactions. The default **Code changes**
mode applies requested edits directly; **Review changes first** remains available.
Eurosonic projects can also be compiled and repaired in temporary snapshots (see
below). Active Eurosonic debugger commands are available through the chat;
ordinary-editor read-only debugger observations can also be attached explicitly.
Direct C++ programs are not supported by the existing generator;
use a C++ function block called by an ST program.
Responses are selectable plain text, never executed or rendered as HTML.

Editor Undo/Redo/Delete and IEC debugging shortcuts are isolated from sidebar
focus. Native text Undo/Redo works in the draft. Escape closes the sidebar only
when focus is inside it.

## Project and generator context

Each submitted snapshot includes the current project name, active editor, all
POU kinds/languages/bodies/declarations, data types, global declarations, tasks,
program instances, board/compiler/core version, pin mapping and expected IO
layout. Current ST/C++ buffers and FBD/LD stores include unsaved changes. Pending
declaration code is authoritative even when incomplete; stale table variables
are omitted. Capturing does not save, parse/commit declarations or mutate stores.

The snapshot is an allowlisted projection, not a directory upload. Connection
credentials, runtime JWTs, debugger values and project filesystem paths are not
added. User-written source/comments are included verbatim and can themselves
contain sensitive information; use Preview to review them. A 160 KB UTF-8 limit
rejects the whole snapshot with an actionable message rather than silently
omitting POUs. Disable context to send an ordinary message. Earlier submitted
snapshots remain in that chat; New chat starts a fresh conversation. The newest
snapshot supersedes earlier context, but cannot prove compiled or deployed state.

The editor ships versioned background guidance with each snapshot. Another user
does not need the developers' earlier chats: the guidance explains POU kinds,
declarations versus bodies, task/program scheduling, GEN2 IO address conventions
and the Eurosonic C++ function block bridge (setup/loop, per-instance IEC state,
case-sensitive variables, explicit helper arguments, nonblocking cyclic calls).
It is derived from the repository contracts listed in the preview. It is not
the full firmware manual: unknown APIs, wiring/scaling and additional generator
capabilities must not be invented. Extend this contract alongside future
firmware integrations; refactoring remains deferred.

Hardware observations are read only by the existing explicit Read hardware
action in Configuration. A detached in-memory cache preserves the result across
editor tabs, bound to the project, board and configured host. It is cleared on
project close/switch; it is not persisted in the PLC project. A cancelled/failed
read invalidates previous data as current evidence. Context distinguishes the
expected modules from detected modules and flags foreign targets, unsupported
metadata, communication failures and expired data. The 30-second lifetime is
rechecked in the main process immediately before transmission, even if thread
startup was slow. Historical observations remain labelled as such. Physical
slots, ordinal DIO card numbers and terminal pins are not interchangeable.
Unknown module types have no invented address map; non-GEN2 boards get no GEN2
slot map. No live IO values or automatic scans are attached.

Only ordinary project data/expected IO layout are saved by the existing Save
action. The Codex snapshot itself is not saved in project files. Generator
guidance is application code, and conversation state remains session-only in
OpenPLC. Sending transmits the selected message/context to the Codex service.

## Reviewed project changes

Enable ST / C++ editing is on by default when project context is included.
Choose **Review changes first** to use the manual workflow described in this
section; the direct mode below uses the same validation and transaction engine.
The native app-server's `turn/start.outputSchema` requests a structured final
answer containing an explanation, up to eight complete POU changes and up to
eight new program instances. The model has no filesystem or editor tools.
Only fully completed, schema-valid replies become proposals; partial, stopped,
malformed and old-project replies cannot become actionable changes. Ordinary
chat disables the structured response schema explicitly. No compiler success
is implied by a structurally valid proposal.

Review changes displays before/after declarations and bodies, documentation,
return types and new task assignments. Apply changes revalidates against the
current in-memory project, including unsaved declarations and graph buffers.
If content, board or expected IO layout changed after the request, the proposal
is rejected rather than overwriting newer work. Navigation alone does not
invalidate it. Identifiers, case-insensitive collisions, declarations, known
types, supported C++ entry points and the existing generator ABI are checked.
Changing existing public interfaces, function return types, located-variable
bindings, POU kind/language or deleting/renaming objects is deliberately excluded
pending the refactoring package. New instances may only reference existing tasks
and resulting programs, without duplicate scheduling. Newly created programs
without an instance are explicitly labelled unscheduled.

Apply prepares the whole batch first, then changes the store once. It updates
POUs, pending declaration editors, file registrations and the user library (so
new FBs/functions can be selected in FBD/LD). It marks work unsaved and writes
no project files. The ordinary Save operation persists the result. Applying a
proposal does not start compilation, download or execution. Applying/undoing is blocked
while the PLC debugger is active or a save request is pending.

Undo last Codex change restores the pre-apply project/editor state, including
previously unsaved buffers. It refuses to overwrite work edited or saved after
the batch; it is a guarded undo of the latest Codex batch, not arbitrary history
refactoring. Existing per-POU history for changed POUs is cleared on apply to
avoid replaying obsolete variable interfaces, and restored by batch undo.
The change review is isolated from editor keyboard shortcuts, like the context
preview. Closing a review cancels without changing anything.
Codex controls are excluded from the declaration editor's automatic outside-click
commit. Opening a chat or review preserves pending declaration text; ordinary
editor interactions retain their existing commit behavior.

## Architecture and authentication

Electron main owns a native `codex app-server --listen stdio://` child and its
JSONL transport. Renderer IPC is a typed, validated allowlist restricted to the
main window/main frame. It exposes no generic RPC, commands or credentials.
The service handles initialization, request timeouts, cancellation, child exit,
streamed items, stale responses and project changes. Unexpected agent tools are
rejected; command/file approvals are declined. EOF permits orderly shutdown of
the app-server's hosts before a timed termination fallback.

The child uses its own CODEX_HOME under Electron userData/codex-profile, an
empty chat-workspace directory, and cli_auth_credentials_store=keyring.
Codex manages browser OAuth/refresh tokens using the OS credential store.
The UI receives account display fields only. There is no password/API-key form,
token copying from the default Codex profile, raw RPC logging, or credential
persistence in PLC projects. Inherited Codex/OpenAI/ChatGPT settings and
credentials are removed from the child environment. Sign out affects this
separate profile; Disconnect stops the process without signing out.

Only HTTPS login URLs on expected OpenAI/ChatGPT hosts can be opened. Login can
be cancelled, reopened, or retried after its five-minute timeout. Credentials
never appear on the command line or in renderer state.

Chats are ephemeral and kept in memory for this project session. The working
directory is never the PLC project. Read-only sandbox and no command-network
access are explicit. Shell tools, Code Mode, apps, plugins, hooks, multi-agent,
view-image and web search are disabled. The client never grants file/command
approvals or exposes PLC operations. Review permissions separately before
adding future project tools.

## Runtime and other users

The tested protocol/runtime is Codex CLI 0.157.x. Other versions fail with an
actionable compatibility message instead of silently changing protocol or
permission behavior. No npm package or Node.js process is needed at runtime:
OpenPLC starts the native executable directly, without a shell and with a
hidden Windows process. Native executable selection is available if discovery
fails.

Discovery checks a selected executable, then a bundled runtime under installed
resources/bin/codex/bin/codex.exe (or resources/bin/codex/codex.exe), then PATH
and the standard global npm package layout. A selected path is stored only in
local userData/codex-runtime.json.

The existing Windows electron-builder mapping copies resources/bin/win32/x64
to installed resources/bin. For the next installer build, stage the pinned
native vendor tree into its codex subdirectory, preserving bin, codex-path,
codex-resources and metadata, and include upstream license/third-party notices.
Never ship an auth profile or local settings. This source change does not add
a runtime binary or create an installer; staging and validating that payload
remains part of the next installer build.

Mikkel and other local users use their own account with Codex access. The
ChatGPT desktop application alone is not this runtime. An authenticated OpenPLC
profile is recognized on Connect. No account is shared through Git.

OpenAI currently documents app-server authentication for local/open-source
applications, but says it is not permitted for commercial/hosted services.
Commercial customer distribution requires a supported authentication arrangement
(the documented Sign in with ChatGPT route), independently of bundling the
runtime. Keep that release decision separate from this local pilot.

References:
- https://developers.openai.com/codex/app-server
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/siwc

## Refactoring remains deferred

Future project tools must use editor transactions and account for unsaved
buffers, stable object identities, verified IO slot/channel mappings, reference
tracking, previews and undo. Selecting hardware or opening a chat must never
rewrite PLC addresses implicitly. Automatic IO refactoring stays in the final
work package.

## Validation and acceptance

Automated service/transport tests cover fragmented JSONL, out-of-order replies,
credential redaction, denied tools/permissions, timeouts, sign-in/cancel,
account projection, streaming/final-item replacement, double-send prevention,
stop, crashes/reconnects and project changes during pending work. Context tests
cover pending declarations, graph buffers, detached snapshots, credential
exclusion, target binding, expiry after thread startup, unknown metadata,
payload limits and failed/cancelled IO reads. Edit tests cover atomic batch creation,
ST functions/FBs/programs, C++ validation, declaration synchronization, protected
interfaces/locations, name conflicts, stale baselines, task assignments, guarded
undo, complete structured replies and cancelled/late/invalid results. All 415
tests passed. Production main and
renderer builds and targeted ESLint passed. Source TypeScript checks use --skipLibCheck because
dependency declarations have existing iterator-type conflicts.

The installed 0.157.0 binary was exercised with a separate empty profile:
initialize, account/read, config/read and ephemeral thread/start succeeded.
Read-only/no-network settings and disabled shell/apps/Code Mode were confirmed.
The default CLI was signed in while the isolated profile was signed out.
An isolated production Electron test verified real native startup and account
lookup through IPC. Simulated server replies exercised sign-in/cancel, model
selection, chat/streaming, Stop, Sign out and transcript retention. HTML-like
answer text remained inert. Light/dark and minimum-window layouts were checked;
the unsaved ST buffer and project files remained unchanged.

The context-stage Electron test also verified preview/background guidance,
fresh unsaved source on each send, context opt-out, detached IO inventory across
tabs, failed-read invalidation, preview keyboard isolation and minimum-window
layout. It used simulated Codex/hardware replies and left the test project files
byte-for-byte unchanged.

The edit-stage Electron test used a disposable project and simulated model
replies. It created an ST program/function/FB plus a C++ FB and task instance,
cancelled/applied/undid whole batches, edited existing ST/C++ while preserving
unsaved source, rejected stale proposals/undo, and verified no POU files were
written until explicit Save. Normal Save and reopen retained the changes and
task assignment; the original test project was unchanged. The older print-only
fixture lacked graphical node flags required by Save; those flags were added
only in the disposable test copy, not in application code or user projects.
The final UI run also opened the newly created C++ POU before batch undo, tested
Escape without closing the sidebar, and checked readable light/dark review
layouts at normal and minimum window size. Codex clicks preserved declaration
buffers instead of triggering the editor's outside-click parser.

No credentials were copied and no authenticated model request was made by these
tests. First real browser sign-in and a quota-consuming answer remain manual:

1. Start the editor, open a project, and open Codex.
2. Connect Codex; select its native executable only if discovery fails.
3. Sign in with Codex, finish the browser flow with your own account, and return
   to OpenPLC. Account information and the model list should appear.
4. Ask a small question, for example: "Explain TON in Structured Text."
5. Close/reopen the sidebar; the answer and an unsent draft should remain.
6. Stop a response; switch projects; no old answer may appear in the new one.
7. Disconnect/reconnect: credentials remain. Sign out/reconnect: sign-in is
   required again. The separate Codex desktop/CLI login remains unchanged.

Project-context acceptance (no download/debugger required):

1. Open a test project; edit ST or C++ without saving. Open Codex and Preview
   project context. Confirm the changed body, declarations, task interval,
   program instances and board. Source project files must remain unchanged.
2. In Configuration, use Read hardware if the generator is available. Open a
   POU tab, then the context preview: expected and detected modules must remain
   separate; slot 2 DIO channel 1 maps to `%QX120.0`. After 30 seconds, reopen
   preview and verify `stale`. A failed read must produce `failed`, not `fresh`.
3. Ask Codex to explain the project, generator constraints and IO mapping.
   It should use the supplied snapshot and ask about ambiguous physical slots,
   terminal pins or toggle/full-period timing rather than inventing them.
4. Change the body again and send another question: the new snapshot must
   contain the latest edit, independent of the previous preview.
5. Disable Include current project and IO context and send. No new snapshot is
   attached. New chat clears the previous conversation; opt-out alone does not.
6. Close/reopen Codex, use the preview and its copy/select shortcuts, then
   return to the editor. Pending edits must remain intact. No compilation,
   file save, PLC download or hardware output operation occurs from chatting.

Edit acceptance:

1. Use a project copy. Enable project context and ST / C++ edit proposals.
   Ask for a small ST program, an ST FB and a C++ FB with explicit declarations.
   A useful request is: "Create a C++ FB that toggles every 50 calls, and an ST
   program that calls it every cycle. Use an existing 10 ms task if available.
   Do not assign a physical output yet."
2. Review changes. Check before/after, variable classes, task interval and
   instance assignment. Cancel once: no POUs should have appeared. Apply:
   POUs should appear, new FBs/functions should be in the user library and the
   project should be unsaved. Compilation/download must not start.
3. Undo last Codex change: new POUs/instances should disappear and earlier
   unsaved content should return. Reapply, then request a body update; existing
   code unrelated to the request must be retained in the proposal.
4. Change source manually after receiving a proposal, then try Apply: it must
   report that the project changed and preserve your edits. Request a fresh
   proposal. Interface/IO-refactoring requests are intentionally rejected.
5. Save the project, close/reopen it and verify the resulting POUs and task
   instance. Compile using Compile Only and inspect diagnostics before any PLC
   download. Model-generated algorithms still require normal engineering tests;
   this stage validates structure/compatibility, not arbitrary ST/C++ semantics.

## Compile and repair

The sidebar action **Compile and fix errors** compiles the current buffers,
including unsaved ST/C++ and declarations, in a dedicated temporary directory.
It currently supports Eurosonic targets; projects with Python POUs are rejected.
Graphical POUs are compiled through the existing generator but cannot be changed
by the repair loop. Incomplete declaration blocks and outdated graphical library
interfaces must be corrected first.

The host reuses `CompilerModule.compileProgram` with compile-only forced true,
no target credentials and a rejecting runtime API adapter. The IPC accepts only
a validated project-data snapshot and an installed Eurosonic board ID, never a
project path, command, executable or upload option. Temporary files are removed
after each attempt. Success requires the compiler's final completion marker,
including the existing OPEN_PLC.bin validation, not a matching log message.
The ordinary compile/download workflow has no behavior changes.
An existing shared comment-normalization bug was found during native validation:
a complete IEC comment at the very end of ST source received an extra `*)`.
The EOF check now preserves that comment; nine regression cases cover the fix
and the existing string, C-block and other comment handling.

On source errors, bounded diagnostics and generated-source excerpts are sent to
Codex with a fresh snapshot of the staged revision. Up to three correction rounds
are allowed (four compilations). Existing edit validation protects public
interfaces, located variables, task assignments and unsupported POU languages.
Repeated revisions, environment failures, invalid replies and project changes
stop the loop. Intermediate proposals are marked scratch-only and never have an
Apply button. Only a successfully compiled, combined proposal is reviewable.
Applying and undoing still use the existing atomic editor-buffer operations;
neither action saves files or downloads to the PLC.

Stop interrupts an active model response immediately; an already running native
compilation finishes and its result is discarded. No later correction round is
started. Project switches and debugger activation also invalidate the workflow.
Compiler success verifies translation/linking and binary format/size, not PLC
behavior or timing. Refactoring remains deferred.

Acceptance:

1. Open a test project on a Eurosonic target, disconnect its debugger, sign in
   to Codex and enable context plus edit proposals.
2. Introduce a small ST body error, e.g. `Counter := ;`, and leave another
   unrelated edit unsaved. Click **Compile and fix errors**.
3. Inspect **Compiler diagnostics** and the completed correction proposal.
   Before Apply, both the original editor buffers and disk files remain unchanged.
4. Review and apply the correction. The unrelated edit must remain, the project
   stays unsaved, and **Undo last Codex change** restores the original buffers.
5. Repeat with a C++ FB body error such as `Lamp = ;`. Check that compilation
   reaches C++ and the final binary validation after correction.
6. Run on a valid project: it reports success without asking the model to edit.
7. Stop a run, or edit the project while compiling: no result may be applied
   automatically and no further correction should run after invalidation.

Compile-stage validation: 440 tests across 58 suites passed, plus the updated
transport test for hidden scratch-only messages. Production main/renderer
builds, source TypeScript (`--skipLibCheck`) and targeted ESLint were checked.
The isolated Electron test used the real installed IEC, C++ and linker toolchain
and simulated model replies: ST syntax error -> staged correction -> C++ syntax
error -> staged correction -> validated 5,248-byte OPEN_PLC.bin. Review/apply/undo,
preservation of unrelated unsaved source, cancellation and stale-result rejection
were exercised. Project files remained byte-for-byte unchanged, and no hardware
download or authenticated model request was made. A real account's correction
quality remains part of the manual acceptance above.
The final UI run also recompiled the applied, still-unsaved valid project without
another model request, verified that internal repair messages stay hidden, and
checked the sidebar in light mode and a small dark-mode window.

## Starting compilation from chat

With project context and edit proposals enabled, a normal chat turn also offers
the structured action `compile-and-fix`. For example, send:
"Kompiliere das aktuelle Projekt und korrigiere die Compilerfehler."
The model must choose `none` for explanations, quoted/negated instructions and
ambiguous requests. A compile-only request without corrections is not silently
converted into permission to repair. This is model intent interpretation, not a
keyword trigger in the editor.

The completed reply can contain either edits or a compile action, never both.
Creating code and compiling it therefore requires applying the changes first
(directly or through review), then requesting compilation of that current project. Internal
repair turns retain the old edit-only schema and cannot recursively start builds.

The main process supplies the action's original snapshot, selected model and
renderer-generated request ID; the model supplies no command, path or upload
parameters. The renderer accepts only an action for a locally initiated pending
send, once, and only after the turn is complete. Cancel, project changes,
disconnects, errors, reloads and transcript replay cannot start an old action.
The existing build runner checks the original snapshot against current buffers
before its first compilation. A changed project requires a fresh request.
The button and chat action use the same isolated build/repair runner, limits,
debugger guards, review and undo. Compiler diagnostics and progress remain in
the sidebar's compilation section.

Acceptance additions:

1. Ask how compilation works: no compiler process should start.
2. Send the explicit example above in a test project with an ST/C++ syntax error.
   The compiler workflow should start without clicking the button; review and
   apply only the successful combined correction.
3. Stop the initial answer before it completes: no delayed build should start.
4. Edit the project while the initial answer is pending: the action should be
   rejected as stale before invoking the compiler.
5. Close/reopen the sidebar or continue chatting after a completed build: the
   historical request must not run again. The existing button still works.

Chat-action validation: 467 tests in 60 suites passed, including complete-turn
dispatch, action/edit exclusion, cancellation, stale baselines, replay rejection
and ordinary proposals under the extended schema. Native Electron validation
started the real ST/C++ repair workflow from a chat send, using simulated model
replies. It checked questions without an action, a deliberately late reply after
Stop, repeated state events, edits while the initial reply was pending, the
existing button, review/apply/undo and byte-for-byte source-file preservation.
A separate editor regression run covered ST/C++ creation and updates, guarded
undo, normal Save/reopen and preservation of previously unsaved code. These
tests do not replace real-account/model acceptance.

## Read-only debugger observations

The sidebar checkbox **Include debugger observations (read-only)** is off by
default and requires project context. Turning project context off also clears
this opt-in. Preview shows the same bounded projection that is refreshed when
sending a message. The existing debugger must be connected manually and variables
selected for observation first. Codex cannot initiate a connection or a download.

The existing status/watch pollers feed a separate transient observation cache;
opening Codex, previewing and sending never make additional PLC requests. Session
tokens bind observations to project path, board, transport configuration and
debugger target. Closing a session, switching targets or receiving an old session's
late response cannot populate the next session. Carried-forward watch values are
not promoted to new samples. A changed variable index is excluded.

Attachments include up to 64 sampled variables (value, index, timestamp and forced
state where known), IEC status, up to 32 stack frames from a particular halt and
the editor's selected FB instances. The internal cache is limited to 256 values;
overflow and omitted values are reported. Legacy variable observations work
without IEC metadata. Source paths, logs and credentials are not attached.

Freshness is evaluated again in the main process immediately before the model
turn, after asynchronous thread startup. Samples older than five seconds are
stale. Samples are not simultaneous; they cannot prove short pulses or physical
output voltage. The local build ID and source locations are references only:
matching the running binary to current editor buffers is **unverified**. Unsaved
source is marked explicitly. A call stack is tied to its sampled halt and cleared
when another halt or continuing execution is observed. There is no native C++
source stepping; C++ FB data can be observed through the IEC bridge.

This step adds no execution, breakpoint, write, force or upload commands. The
existing guards against applying changes or compiling while debugging remain.
Previous observations stay historical in the conversation; opting out does not
erase earlier messages. Start a new chat to discard the previous conversation.

Manual acceptance:

1. Open a test project, connect the normal debugger and select variables to watch.
2. Open Codex, enable project context and debugger observations, then preview.
   Check the target, timestamps, values and unverified source-match indication.
3. Ask, for example: "Warum schaltet Lamp nicht um? Prüfe die mitgesendeten Werte."
   Each send captures new observations; there is no continuous model subscription.
4. At an IEC breakpoint, preview status/location/stack. Resume using the ordinary
   debugger controls and send again. Old frames must not describe a new halt.
5. Disconnect: a new preview must contain no variable values. With communication
   lost but the debugger still open, old samples must become stale after five seconds.
6. Disable project context: debugger sharing must clear. Re-enabling project
   context must not silently re-enable debugger sharing.
7. Compilation and applying proposed edits remain blocked during debugging.
   Disconnect before reviewing/applying a correction and compiling it.

Validation: 483 tests in 61 suites passed, source TypeScript (`--skipLibCheck`),
targeted ESLint and production main/renderer builds succeeded. An isolated
Electron run exercised the actual editor polling with simulated PLC replies:
default opt-out, preview, attached values/status/stack, stale data after a simulated
outage, empty observations after disconnect, opt-in reset, the active-debugger
compile guard and light/dark sidebar layouts. The test made no hardware writes
and left its source files byte-for-byte unchanged. PLC transport replies and model
replies were simulated; real hardware/account acceptance remains the manual check.

## Direct requested edits and undo

With project context and ST/C++ editing enabled, **Apply requested changes directly**
is the default mode. An explicit request such as "Bitte ändere HalfPeriodCycles
auf 100" returns structured POU replacements/creations and is applied to editor
buffers after validation. Explanations/questions still return no edits. Mode
selection is sent per turn, so a prior review-only conversation does not dictate
the next turn's behavior. The model must return actual structured changes rather
than asking users to copy a snippet manually.

The renderer creates a unique apply request ID. Only a completed, validated main
process reply tagged with that same ID can trigger an automatic transaction.
Streaming, old transcript replay, repeated state events, reload, Stop, disconnect,
project changes and compiler repair turns cannot auto-apply historical edits.
No generic filesystem/command execution or native Codex write permissions were
added. Direct and reviewed edits share `prepareCodexChanges` and the same atomic
store update. Active debugger, saves, changed baselines, unsupported interfaces,
invalid declarations and name collisions still block the entire transaction.

Each chat reply with changes shows the actual host outcome: applied, blocked or
undone, together with the affected POU names. **Undo this change** restores the
latest transaction, including previous unsaved buffers, registrations and program
instances. It refuses to overwrite subsequent edits/saves. This is one guarded
transaction undo, not an unbounded cross-session undo history. **Review this change**
opens the before/after dialog for pending or blocked proposals. Existing top-level
review and undo controls remain available, including compiler repair proposals.

**Review changes first** retains manual application. Automatic compiler repairs
also retain their review step; direct editing does not silently broaden the
existing compilation/download permissions. Nothing is saved or downloaded by an
edit transaction. New ST programs/functions/FBs and C++ FBs use the existing editor
and library registrations; C++ programs and interface/IO refactoring remain outside
the supported scope.

Manual acceptance:

1. Start the updated editor with the PLC debugger disconnected. Enable project
   context and ST/C++ editing; select **Apply requested changes directly**.
2. Ask for a concrete change in an existing ST program or C++ FB. The source should
   update without an Apply click and the reply should show **Applied to editor**.
3. Use **Undo this change** immediately: the previous source, including unrelated
   unsaved work, should return. A later manual edit/save must block this undo.
4. Request a new ST program/FB/function or C++ FB and inspect its project/library
   registration. A program only runs if it has a task instance.
5. Repeat in **Review changes first** mode: source changes only after Apply.
6. Edit manually while an answer is pending, or stop the answer: no late automatic
   replacement should overwrite those buffers. Ask for a fresh change afterward.

Validation: the full suite passed 507 tests in 62 suites. After adding the
unscheduled-program message, the affected transaction/dispatch suites passed
37 tests including the additional case. TypeScript (`--skipLibCheck`) and targeted
ESLint passed. The isolated Electron acceptance uses simulated model replies with
the real renderer/store: direct ST updates, C++ FB/ST program/FB/function creation,
task/library registration, inline outcomes, undo, replay/cancellation rejection,
stale-source rejection, manual review mode, later-edit protection and opt-out.
Its project files remain byte-for-byte unchanged; no real model or PLC is invoked.
Production main/renderer builds passed. The final Electron run also checked the
unscheduled-program warning and the inline rejection of undo after later manual
edits, in addition to the full direct/review workflow above.

## Active debugger commands

**Enable active debugger commands** is on by default with project context. A
request such as "Verbinde den Debugger und lies Blink1.Counter und Blink1.Lamp"
can attach to the configured Eurosonic Modbus TCP target and read values, status
and the IEC call stack. This is a separate owned connection; the ordinary PLC
debugger must be disconnected. Static targets come from Configuration; for DHCP,
enter **PLC target IP (DHCP)** in the sidebar (session-only, shared with the normal
debugger's temporary IP). The model cannot choose the target. Only a completed response bound to the current local
request, source snapshot and target can trigger a command. Old replies, replay,
project/target/source changes and cancellation cannot start new commands.

`connect`, `observe` and `disconnect` do not alter PLC execution. Setting/removing
a breakpoint, continue and step into/over/out require **Execute debugger command**
after reviewing the operation, target and (for breakpoints) POU/line/statement ID.
Execution commands require an existing session; stepping/continue additionally
require an IEC halt. Firmware capabilities and metadata IDs are checked before
each command. The bridge exposes no variable writes/forcing, PLC RUN/STOP or
download operation. Native C++ source stepping is not implemented; C++ FB values
are accessible through the existing IEC bridge.

Connecting checks the current unsaved snapshot against local `plc.xml`, external
POU source files, ST/source-map hashes and enriched debug metadata. It then checks
the live PLC program MD5. These checks repeat before subsequent operations. The
debug include wrapper now embeds a SHA-256 body hash as an ST comment: xml2st's
MD5 previously included the include filename but not the external body's bytes.
The comment binds ST and native C++ source changes to the existing PLC identity
without changing runtime logic or body-local debug line locations. Older builds
without this binding are refused. Changed, missing or inconsistent artifacts are
errors, never authorization to build or download.

The active debugger does not invoke a compiler, save project buffers or upload.
For the first use, explicitly create/upload an instrumented build using the
existing ordinary PLC debugger workflow, then disconnect that debugger. A plain
compile-only check in the Codex sidebar does not prepare/upload an instrumented
program. Further compilation remains the separate, explicitly requested compile
workflow; PLC downloads remain in the existing manual workflow.

Each operation reads at most 24 variables (default 12), returns a bounded catalog
and samples status/stack. Variable suffixes must be unambiguous; full instance
paths are preferred. Values are sequential samples, not simultaneous or continuous
monitoring. The host sends the result back for an **analysis-only** Codex turn:
that turn cannot dispatch another debugger command, compiler action or edit.
Another observation requires another user request. Observation timestamps are
included; the model must not treat a previous sample as current hardware state.

While attached, Codex edits/undo and compilation are blocked. Manual source/target
changes invalidate the connection. **Close Codex debugger connection**, disabling
active commands/context, Stop/New chat/sign-out/disconnect, project changes and
window teardown release only the owned TCP connection. They **do not clear
breakpoints or resume a halted PLC**. Cancellation prevents further commands but
cannot undo a command already sent. Confirm continue or remove a breakpoint
explicitly before disconnecting if that is the desired PLC state.

Manual acceptance:

1. On a suitable test setup, explicitly build/upload an IEC-instrumented program
   using the ordinary debugger, then disconnect it. Keep the same source and
   configured TCP target. The first updated build provides the new body identity.
2. For DHCP, enter the target IP in the sidebar. In Codex, ask "Verbinde den Debugger und lies Counter" (or the full variable
   path). Expect values/status followed by an analysis, without compile/upload logs.
3. Ask for a breakpoint at a known ST statement. Check the target and source line,
   dismiss once, then repeat and confirm. Only confirmation may send the command.
4. At a halt, ask for a single step; confirm it. Request fresh observations and
   explicitly continue/remove breakpoints when finished.
5. Close the Codex connection. Verify the connection-close message clearly states
   execution/breakpoints are unchanged. Ordinary editor controls become available.
6. Change source or target, or use old/missing artifacts: attachment must refuse
   and must not automatically compile or upload. Existing unsaved work stays intact.

Validation of active debugging: the full suite passed 556 tests in 65 suites;
additional service cases cover preservation of direct edits and explicit chat
compilation with the active-debug response schema. TypeScript (`--skipLibCheck`),
targeted ESLint and production main/renderer builds passed. Shipped xml2st/MatIEC
were exercised on disposable ST sources: body changes alter the MD5 and body-local
statement locations remain correct. Backend transport tests cover confirmation,
source/target/session mismatch, unsupported capabilities, cancellation during
awaits and disconnect without resume/clear. Isolated Electron acceptance passed
chat dispatch, DHCP target entry/change, attach/read, breakpoint dismissal,
confirmed stepping, analysis-only follow-up, replay/stale guards, compile/edit
blocking and source-change invalidation. The existing direct-edit/undo workflow
also passed again with the new build. Both UI fixtures retained their project
files byte-for-byte. Hardware/model responses were simulated; no real PLC was
contacted or downloaded, and real-device/account acceptance remains the manual
check above.

## Remaining work from the integration plan

Implemented: floating button/sidebar; native-runtime connection and individual
account sign-in; project/generator context; IO inventory and expected/observed
comparison; direct or reviewed ST programs/functions/FBs and C++ FB edits; compilation
and bounded repair through the button or chat; opt-in read-only debugger observations;
active source-verified Eurosonic TCP debugging with confirmed execution commands.

Remaining:

- Native C++ source debugging and additional debug transports; variable forcing
  and chat-controlled PLC downloads remain outside the current interface.
- Refactoring, deliberately last: reference tracking and reviewed transactions
  for renames, interface changes and IO address/module remapping.
- Distribution: stage the pinned native runtime and its notices in the Windows
  installer, validate discovery on a clean second computer, and test sign-in,
  context, generation and correction with that user's own account.
- Real-account acceptance: native compilers and editor operations have automated
  coverage; simulated model replies do not establish a real model's interpretation
  or correction quality for customer projects.
