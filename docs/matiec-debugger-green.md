# MatIEC IEC Debugger: GREEN design and implementation plan

## Scope

This document defines the GREEN stage of the Eurosonic IEC 61131-3 debugger. It deliberately does not implement
the YELLOW call-stack/instance features or the RED graphical/online-change features. The design reserves the data
fields required by those stages so that GREEN does not create an incompatible protocol or compiler ABI.

The supported target is `Eurosonic_Gen2 [2.11.0]` on STM32H747/FreeRTOS. MatIEC remains the IEC-to-C compiler. No
OpenPLC Linux/Windows runtime is ported.

## Verified baseline

| Area | Baseline |
| --- | --- |
| MatIEC source | `Autonomy-Logic/matiec` tag `v4.0.9`, commit `8d220fd76dc9bfde839ab5c6ea3bc222356f4aae` |
| Eurosonic debug fork | branch `codex/matiec-debugger-gruen`, commit `6300e39739cc25ea03d1e93b196efa73527ad784` |
| Bundled compiler | `resources/bin/*/iec2c`, reports `matiec version 4.0.9`, changeset `8d220fd` |
| MatIEC ST generator | `stage4/generate_c/generate_c_st.cc` |
| AST source locations | `symbol_c::{first,last}_{file,line,column}` in `absyntax/absyntax.hh` |
| Existing variable metadata | `VARIABLES.csv` plus xml2st-generated `debug.c` |
| Existing debug transport | Modbus custom function codes `0x41` through `0x45` |
| Existing PLC ABI | `init_plc` at `0x081C0400`, `run_plc` at `0x081C0500`, legacy function table at `0x081C0600` |
| Existing force mechanism | MatIEC `__GET_*` / `__SET_*` accessors and `__IEC_FORCE_FLAG` |

The old MatIEC source below the local `OpenPLC_v3` checkout is not the source of the bundled v4 compiler and must
not be modified for this work.

## Architecture decisions

### 1. Compiler switch and production output

MatIEC gets an explicit, cross-platform command-line switch for PLC debug generation. The switch is stored in
`runtime_options` instead of the Unix-only `-O` sub-option parser, because the current Windows compiler ignores
`-O` sub-options.

Without the switch:

- no `PLC_DBG_*` hooks are generated;
- no statement/POU metadata file is generated;
- generated production C remains byte-for-byte compatible wherever possible;
- no statement-debug runtime source is linked into the PLC image.

With the switch, MatIEC emits hooks and `program.debug.json`. The OpenPLC build pipeline then enriches that same
file with the existing variable registry.

### 2. Stable IDs

All controller IDs are unsigned 32-bit values. Value `0` is reserved for “none/unknown”. IDs are deterministic
FNV-1a hashes of canonical UTF-8 keys. A build fails on a detected collision instead of silently assigning an
order-dependent replacement.

| ID | Canonical key |
| --- | --- |
| POU ID | `pou-v1:<kind>:<upper-case-pou-name>` |
| Statement ID | `stmt-v1:<pou-id>:<normalized-source-file>:<start-line>:<start-column>:<end-line>:<end-column>:<kind>` |
| Variable ID | `var-v1:<normalized-full-instance-path>:<iec-type>` |

Statement ID, POU ID and Instance ID remain separate in every hook, status structure and metadata record. GREEN
uses Instance ID `0`; it never substitutes a POU ID or pointer value for an instance.

### 3. ST source mapping

The normal xml2st output is one generated `program.st`, so its line numbers do not match the body-only Monaco ST
editor. For an instrumented ST build, the Editor writes each textual POU body to a deterministic source file and
places a MatIEC include pragma in the generated POU body:

```text
{#include "main.st"}
```

MatIEC already tracks included filenames and resets line/column positions for them. Statement metadata therefore
uses the original body-local line numbers without teaching MatIEC about PLCopen XML or the Editor project model.
Generated LD/FBD/SFC bodies retain a generated source name; graphical element mapping remains RED scope.
The Eurosonic scanner extension explicitly recognizes include pragmas while selecting a POU body language; a
regression test ensures that included ST is parsed and never leaks into generated C as a preprocessor include.

### 4. Semantic debug points

Instrumentation is added through a small debug metadata/helper component and narrowly placed calls in the current
ST generator. It is not based on generated C line numbers.

| ST construct | GREEN execution point |
| --- | --- |
| Assignment, FB invocation, RETURN, EXIT, CONTINUE | Immediately before execution |
| IF | Before evaluating the IF condition |
| ELSIF | Before evaluating that ELSIF condition |
| ELSE | On entry to the ELSE branch |
| CASE | Before selector evaluation and on entry to the selected arm |
| FOR | At the loop control point for every attempted iteration |
| WHILE | Before each condition evaluation |
| REPEAT | At the beginning of each iteration |
| Function invocation inside an expression | Before evaluating that function call, while preserving expression order and result |

POU bodies emit the following shape when debug generation is enabled:

```c
PLC_DBG_ENTER(pou_id, PLC_DEBUG_INSTANCE_NONE);
PLC_DBG_POINT(statement_id, pou_id, PLC_DEBUG_INSTANCE_NONE);
/* generated statement */
PLC_DBG_LEAVE(pou_id, PLC_DEBUG_INSTANCE_NONE);
```

`ENTER` and `LEAVE` establish a forward-compatible ABI, but GREEN does not build an IEC call stack from them.

### 5. Debug symbol format

The PC-side file is versioned from the first implementation:

```json
{
  "format": "eurosonic-plc-debug",
  "version": 1,
  "id_algorithm": "fnv1a32",
  "build_id": "deterministic-content-id",
  "pous": [],
  "statements": [],
  "variables": [],
  "instances": []
}
```

Statement records contain generated and editor-facing source positions, POU ID, reserved Instance ID, and semantic
kind. Variable records contain stable ID, compact legacy index, path, IEC type, protocol type code, and a writable
flag. The generated controller adapter derives and validates the byte size from the existing variable registry.
Long names remain on the PC and are not stored in the controller.

GREEN writes a build/content ID into the symbol file but does not yet enforce firmware/symbol matching through a
new symbol hash. The existing PLC MD5 handshake remains authoritative until RED.

### 6. Embedded runtime split

The seven-entry legacy table at `0x081C0600` and function codes `0x41` through `0x45` remain compatible. GREEN adds
a separate, versioned interface structure at `0x081C0700`:

```c
typedef struct {
    uint32_t magic;
    uint16_t abi_version;
    uint16_t struct_size;
    uint32_t capabilities;
    /* versioned function pointers */
} plc_debug_interface_v1_t;
```

The M7 firmware checks the PLC image header, magic, ABI version and structure size before calling it. Old PLC images
therefore continue to support variable debugging and report statement debugging as unsupported. New PLC images on
old M7 firmware run normally because no breakpoint can be armed and all hooks take the inactive fast path.

The generated PLC image owns:

- a compile-time bounded, sorted breakpoint list;
- current state and current Statement/POU/Instance IDs;
- the stable-ID-to-legacy-variable-index table;
- `PLC_DBG_ENTER`, `PLC_DBG_POINT` and `PLC_DBG_LEAVE` implementations.

No allocation occurs in a PLC scan. The breakpoint capacity is configurable at compile time and defaults to 64.
The inactive debug-build fast path is one volatile active-state check and a predicted branch per hook. Active
breakpoint lookup is binary search, not a statement-count-sized Boolean array and not a string search.

### 7. FreeRTOS halt and data consistency

The PLC image is OS-independent and receives platform callbacks from the M7 firmware after `init_plc`. A debug point
never executes an ARM `BKPT` and never stops the MCU.

The M7 OpenPLC task owns a statically allocated PLC-data mutex around one `run_plc` call. When a hook halts, its
platform wait callback:

1. releases the PLC-data mutex;
2. blocks the PLC task on a FreeRTOS task notification with a bounded wait;
3. leaves Modbus, Ethernet, web and system tasks running;
4. reacquires the PLC-data mutex before generated PLC code resumes.

This gives coherent 8/16/32/64-bit variable reads and writes without a long global interrupt lock. It also permits
reads, writes and force operations while halted. The bounded wait checks the managed-thread stop request, so a PLC
update can still terminate a halted task.

The physical outputs are not disabled. Because `update_outputs` is not reached while execution is stopped inside a
scan, they naturally hold the last state written by the previous completed scan. Profinet and direct Modbus I/O
remain available.

### 8. Variable read, write and force

The proven xml2st `debug.c` registry remains the single pointer/type source in GREEN. A generated adapter adds stable
variable IDs and validates:

- ID exists;
- transmitted IEC type matches;
- payload size exactly matches the descriptor;
- the operation is permitted.

Operations are distinct:

- **Read** copies the current typed value.
- **Write** copies once through the variable registry without setting `__IEC_FORCE_FLAG`; later PLC execution may
  overwrite it.
- **Force** writes the forced value and sets `__IEC_FORCE_FLAG` through the existing accessor-aware mechanism.
- **Unforce** only clears the force flag.

Existing index-based Force Value remains supported. Its request length is additionally checked against
`get_var_size()` before any copy.

### 9. Protocol

The legacy Modbus functions stay unchanged. A new custom function code `0x46` carries a versioned command byte for:

- capabilities;
- execution status/current statement;
- set/clear/clear-all breakpoint;
- continue;
- step into (`next PLC_DBG_POINT` in GREEN);
- stable-ID variable read;
- stable-ID variable write;
- stable-ID force/unforce.

Reserved command values exist for step over/out, but GREEN returns “unsupported” and does not implement their
semantics.

Protocol integers (IDs, command fields, type codes and lengths) use Modbus/network byte order. Typed IEC value
payloads retain their native MatIEC byte representation. On STM32H7 that representation is little-endian; changing
the byte order of a `DINT`, `REAL`, `TIME` or other multi-byte payload would change the PLC value.

## Implementation sequence

1. **MatIEC generator core**
   - add the cross-platform debug switch;
   - add deterministic ID and JSON metadata helpers;
   - instrument ST semantic execution points;
   - emit POU enter/leave hooks;
   - prove a non-debug compile is unchanged.
2. **Host build integration**
   - create body-local ST include files for instrumented builds;
   - invoke MatIEC with debug generation only in explicit debug mode;
   - merge MatIEC statements with the existing variable registry;
   - generate the controller variable-ID adapter.
3. **Embedded PLC runtime**
   - add the OS-independent fixed-capacity breakpoint/state runtime;
   - add the versioned interface at `0x081C0700` without changing the legacy table;
   - expose validated stable-ID read/write/force operations.
4. **M7 integration**
   - add safe interface discovery and capability checks;
   - add the static data mutex and PLC-task notification wait/wake callbacks;
   - add Modbus `0x46` request validation and commands;
   - retain output HOLD behavior and update-stop handling.
5. **Editor prototype**
   - load `program.debug.json` after a debug build;
   - add ST gutter breakpoints and current-statement decoration;
   - add Continue and Step Into controls;
   - route Watch/Write/Force through stable IDs when capability v1 is available and keep legacy fallback.
6. **Tests and evidence**
   - MatIEC generator golden tests for assignments, branches, CASE, loops, calls, RETURN and EXIT;
   - stable-ID and JSON schema tests;
   - production-output regression test;
   - host registry generation tests including BOOL, 16/32/64-bit, TIME and STRING validation;
   - portable C runtime unit tests for breakpoint, continue, step, write, force and unforce;
   - M7 protocol/parser tests with a fake interface;
   - end-to-end generation of the required `Counter/Limit/Output` ST sample;
   - STM32 build and a hardware acceptance checklist without automatic flashing.

## Implemented GREEN evidence

The implementation is isolated on branch `codex/matiec-debugger-gruen` in the OpenPLC Editor, MatIEC, and M7
repositories. IEC statement generation is explicitly limited to `Eurosonic_Gen2` over Modbus TCP; all other
targets retain the legacy debug compilation and upload behavior.

Automated evidence:

- the MatIEC test compiles the sample twice, proves deterministic IDs, checks every supported semantic hook, and
  verifies that the production output has no instrumentation;
- TypeScript tests cover FNV IDs, source-file mapping, metadata enrichment, collision rejection, Modbus `0x46`,
  one-request watch batches, and STM32-native value byte order;
- portable C tests cover the fixed-capacity breakpoint runtime, Continue, next-point Step, and the M7 parser's
  batched read, Write, Force, Unforce, strict sizing, and little-endian typed payloads;
- Electron main and renderer production builds complete successfully;
- M7 Debug and Release builds complete with zero warnings and zero errors;
- a real Eurosonic PLC ARM build places the legacy interface at `0x081C0600` and the new 56-byte debug interface at
  `0x081C0700`; the corresponding production ARM build contains no debug section, hook, or runtime symbol.

An intentional debugger disconnect clears the controller breakpoint list and resumes a halted PLC task before the
transport is closed. A breakpoint halt itself does not disable outputs; it holds the last completed PLC output state
while the other FreeRTOS tasks continue.

## GREEN acceptance matrix

| Requirement | Evidence required |
| --- | --- |
| Stable statement and POU IDs | Repeat build produces identical IDs; collision test fails explicitly |
| Generated hooks | Golden generated-C assertions for all supported ST constructs |
| Mapping file | JSON schema and source-position assertions |
| Breakpoint set/clear | Runtime and Modbus protocol tests |
| Current statement | Status response resolves through the symbol file |
| Continue | Halted PLC task resumes and completes the scan |
| Step Into | Exactly the next executed `PLC_DBG_POINT` halts |
| Online values/watch | Stable-ID batched reads remain coherent |
| Write | One-shot typed write while halted |
| Force/unforce | Accessor flag semantics and typed Modbus protocol regression; physical `%QW` check on target |
| Production build | No hooks, no statement runtime, no statement metadata |
| Task isolation | PLC task blocked; debug communication remains responsive |
| Output policy | Last physical output state held; no global output disable |

Hardware flashing remains an explicit user action. GREEN is complete only after the generated sample, automated
tests, STM32 build and target-side breakpoint/continue/step/force checks pass. Work stops before YELLOW.
