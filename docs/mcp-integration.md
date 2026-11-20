# Local OpenPLC MCP server

The editor now exposes its shared PLC operations to independent local MCP clients.
The existing Codex sidebar, account/runtime, chat and IPC remain available. This
does not replace Codex with MCP or add a provider selector to the sidebar.

## Connect and test

1. Start the editor normally and open a disposable copy of a PLC project.
2. Click **MCP** in the left activity bar, then **Enable MCP for this project**. It is off by default and
   does not start automatically when the application starts.
3. Under **Show connection settings**, copy the endpoint and authorization header
   into a client supporting Streamable HTTP with custom headers. For clients
   using a JSON configuration, the connection has this shape (field names for the
   transport vary by client):

   ```json
   {
     "url": "http://127.0.0.1:<port>/mcp",
     "headers": { "Authorization": "Bearer <current editor token>" }
   }
   ```

   These are placeholders. Use the current values displayed by the editor. Treat
   the token as private: it allows reading the selected project's unsaved content.
   Do not put it in the PLC project, source control, screenshots or model prompts.
   Provider account login remains the responsibility of the external client.
4. Ask the client to call `openplc_get_context`. Check the project name, unsaved
   source, generator guidance, IO status and slot/channel addresses. IO metadata
   is the editor's existing observation, not a new scan or live IO value read.
5. Ask for a small ST change. The tool returns `review-required` and a request ID.
   Click **MCP** (amber indicator), inspect Before/After and approve or reject.
   Closing the panel does not approve a request. The client polls
   `openplc_get_result`; only `completed` means execution finished successfully.
6. Use **Undo last MCP change**, or request `openplc_undo` and approve it. Later
   manual edits or saves prevent an undo that would discard that work.
7. Ask explicitly to compile. Approve that separate request in the editor.
   Compilation uses a temporary snapshot and returns diagnostics. For corrections,
   the client obtains fresh context and proposes another reviewed change. There
   is no implicit repair loop or PLC download.
8. Active debugging is a separate reviewed request. Configure the PLC target in
   the editor (DHCP target input is also available in the MCP panel). Existing
   matching debug artifacts, firmware capabilities and source identity are
   required. Missing/mismatched artifacts never trigger compilation/download.
9. **Stop MCP** revokes the endpoint/token and clears queued requests. A new start
   gives a new port/token. Project changes, renderer reload, window close and app
   exit also stop MCP. Closing just the panel leaves MCP enabled.

The editor must remain open. This implementation supports native local clients,
not browser-origin or remote/cloud connections. No external client configuration
or account is changed automatically.

## Tools and authorization

| Tool | Effect |
| --- | --- |
| `openplc_get_context` | Reads current unsaved project/device/IO context, generator contract and passive debugger samples; creates an expiring snapshot ID |
| `openplc_apply_changes` | Queues review of up to eight ST/C++ POU changes and eight program instances; applies only through shared editor transactions |
| `openplc_undo` | Queues guarded undo of the latest MCP edit |
| `openplc_compile` | Queues compilation of an isolated snapshot; reports diagnostics and never uploads |
| `openplc_debug` | Queues connect, observe, disconnect, breakpoint, continue or step operations using the source-verified debugger |
| `openplc_get_result` | Reads bounded request status and operation result |
| `openplc_cancel` | Cancels pending work; already completed effects are not rolled back |

Every action consumes one snapshot ID. Snapshots and unapproved requests expire
after two minutes. One action can await review or execute at a time. The last
eight results and at most eight snapshots are held in memory. Unknown, consumed
or expired IDs fail. Source/project/target changes between capture and approval
are rejected. A request ID cannot be approved twice.

All actions, including connect/observe and compilation, need a host-side approval.
The network tool schemas contain no approval flag, filesystem path, arbitrary
target host, shell command, save, force/write, RUN/STOP or PLC download operation.
The editor derives the target and project data and verifies them again at execution.
ST supports programs, functions and function blocks; C++ remains function blocks
only, as in the existing Eurosonic integration.

Cancelling during an isolated compilation discards the result but may leave that
already started compiler running until normal cleanup. Cancelling cannot undo a
debugger command that has already reached the PLC. Disconnecting or stopping MCP
only releases its connection: it does not resume execution or remove breakpoints.

## Implementation boundaries

- `src/main/services/mcp/server.ts`: official TypeScript MCP SDK, Streamable HTTP,
  one SDK server/transport per HTTP request, JSON responses, no unsolicited SSE
  stream or resumable transport session. The application-level result queue
  avoids keeping an HTTP tool call open during human review or compilation.
- `src/main/services/mcp/broker.ts`: ephemeral context IDs, bounded queue/results,
  single-use host claims, cancellation, expiry and project/session invalidation.
- `src/main/services/mcp/ipc.ts`: main-frame-only editor IPC. Native compilation
  and debugging require a matching claimed action and use the same
  `PlcOperationsService` as Codex. Debug cancellation invalidates the owned native
  debugger immediately, including asynchronous validation.
- `src/renderer/components/_organisms/mcp-panel.tsx` and
  `src/renderer/utils/mcp-operations.ts`: current buffer capture, concrete review,
  shared edit/undo operations, snapshot validation, compiler diagnostics and the
  shared debugger hook. MCP has its own guarded undo; it cannot undo a Codex edit.
- Shared debugger ownership prevents an adapter from executing on, closing or
  clearing the activity flag of another adapter's session. The common compiler
  exclusion includes asynchronous debugger validation, not just an open socket.

The listener binds only `127.0.0.1` on an OS-selected port, requires a random
256-bit bearer token, validates the exact Host header and rejects all Origin
headers. It advertises no CORS permission. Requests, connections and context
captures are bounded. Connection settings are held in memory, excluded from tool
results and never stored in a PLC project. The MCP SDK is pinned in the lockfile
and bundled with the application; no separate MCP runtime install is needed.

Protocol references: [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and the [official SDK stateless server example](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/examples/server/simpleStatelessStreamableHttp.ts).

## Validation

Automated tests cover protocol initialization/tool discovery with a real SDK
client, loopback authentication and Host/Origin checks, malformed/oversized
requests, token rotation, snapshot expiry/replay, host approval claims, cancellation,
shared provider ownership, detached compilation and preservation of unsaved work.
Existing Codex and PLC tests remain part of the full suite.

The Electron acceptance test uses an isolated application profile, disposable PLC
projects and a real MCP client. Native compilation is real; PLC replies for the UI
debugger test are simulated. It does not log in to a provider or contact hardware.

Verified on 2026-11-20:

- Full Jest run: **70 suites, 584 tests passed**.
- TypeScript check, ESLint on changed files, main/renderer production builds and
  `git diff --check`: passed.
- Real MCP SDK client against the production Electron editor: disabled default,
  unsaved context and generator/IO guidance, readable Before/After review, ST/C++
  creation, local and requested undo, native compilation only after approval,
  stale/rejected requests, host-approved simulated debugger connect/step, stop and
  token revocation: passed. Original project files remained byte-identical.
- Codex regression acceptance: direct editing/undo, active debugger and chat-based
  real compilation/repair passed. Enabling and stopping MCP during the simulated
  Codex debugger session preserved its activity guards and subsequent operations.
- Light/dark review layouts, including a 1124 × 628 viewport: inspected.

External provider login and physical PLC operation were not part of this test.
