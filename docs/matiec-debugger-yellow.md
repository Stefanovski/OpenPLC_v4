# MatIEC IEC Debugger: YELLOW design and implementation

## Scope

YELLOW extends the proven GREEN STM32H747/FreeRTOS debugger with IEC call context, function/function-block stepping,
instance-aware breakpoints, Locals and bounded advanced breakpoint predicates. MatIEC remains the IEC-to-C compiler;
the Linux/Windows OpenPLC runtime is not used. No RED graphical debugging or online change is included.

The work is isolated on `codex/matiec-debugger-gelb` in the OpenPLC Editor, MatIEC fork and M7 repositories.
Hardware flashing remains an explicit user action.

## Controller architecture

The interface remains at `0x081C0700`, with magic and ABI version `1`. YELLOW appends optional function pointers to
the GREEN structure and advertises them through capability bits. M7 accepts the smaller GREEN structure and only
dereferences the appended fields after checking both `struct_size` and the YELLOW capabilities.

The generated PLC image owns all execution semantics:

- a fixed 16-frame logical IEC call stack;
- a fixed 64-entry, sorted breakpoint table;
- Step Into, Step Over and Step Out state and starting depth;
- compact POU, Statement and Instance IDs;
- condition, change and hit counters.

There is no dynamic allocation, controller-side symbol string, C-stack unwinding or ARM breakpoint. Only the PLC
task blocks; the FreeRTOS communication tasks continue to run. Outputs retain the last completed scan state exactly
as in GREEN.

## POU and instance instrumentation

Functions emit `ENTER/LEAVE` with Instance ID `0`. Programs and function blocks pass their generated `data__`
address:

```c
PLC_DBG_ENTER(pou_id, (uint32_t)(uintptr_t)data__);
/* statement hooks and generated body */
PLC_DBG_LEAVE(pou_id, (uint32_t)(uintptr_t)data__);
```

The address is never exposed as the stable Instance ID. The Editor derives configured program and nested FB
instances from `VARIABLES.csv`, emits a compact address-to-ID table into `debug.c`, and provides the strong
`plc_debug_instance_resolve()` adapter. PC-side metadata retains the readable hierarchy, for example
`MAIN.Pump2`, while the controller only compares 32-bit IDs.

The call stack is maintained whenever the M7 debug platform is bound, even when no breakpoint is armed. Statement
hooks retain the GREEN inactive fast path and do not search the breakpoint table while debugging is inactive.

## Stepping semantics

| Command | Stop rule after resuming |
| --- | --- |
| Step Into | next executed `PLC_DBG_POINT`, including one in a called function/FB |
| Step Over | next point with `current_depth <= start_depth` |
| Step Out | next point with `current_depth < start_depth` |

Step Out at the root program returns `INVALID_STATE`. A halt status contains the current Statement, POU and
Instance IDs. The Editor resolves these IDs through `program.debug.json`, opens the halted ST POU automatically,
reveals the source line, and shows the logical IEC stack rather than the CPU C stack.

## Extended breakpoints

An extended breakpoint is keyed by `(statement_id, instance_id)`. Instance ID `0` means all instances. A descriptor
can additionally contain:

- one scalar comparison (`==`, `!=`, `>`, `>=`, `<`, `<=`);
- one typed variable whose byte representation is monitored for change;
- a positive hit target.

Values are transferred in native MatIEC little-endian representation and checked against variable type and size.
Conditions are evaluated without string parsing in the PLC scan. Supported comparison values are BOOL, signed and
unsigned integers, BYTE/WORD/DWORD/LWORD and REAL/LREAL, up to eight bytes. Break-on-change also supports any
registered value up to eight bytes. STRING and compound values are intentionally not comparison operands.

The breakpoint table remains sorted. Exact breakpoint updates and removals use binary lookup; execution starts at
the binary lower bound for a statement and only scans entries for that statement. With no active breakpoint or step
operation, `PLC_DBG_POINT` remains a predicted inactive branch.

## Locals and compound watches

MatIEC's `VARIABLES.csv` is the pointer/type source. YELLOW adds elementary-field expansion for user-defined
structures; arrays and FB members are already expanded by the generator. The Editor binds every flattened variable
to the nearest configured IEC instance and presents readable paths:

```text
MAIN.Values[0]
MAIN.Config.Limit
MAIN.Pump2.Counter
```

Internal C paths such as `.value.table[0]` remain in generated pointer expressions but are removed from PC-facing
names. While halted, Locals batches up to 24 stable-ID reads per request and observes the Modbus frame-size limit.
Nested FB variables belong to their own instance context, so Pump1 and Pump2 never share a local variable ID.

## Editor controls

The textual ST editor uses standard debugger symbols and Visual Studio-compatible shortcuts:

| Action | Shortcut |
| --- | --- |
| Continue | `F5` |
| Toggle breakpoint | `F9` |
| Advanced breakpoint | `Shift+F9` or right-click gutter |
| Step Over | `F10` |
| Step Into | `F11` |
| Step Out | `Shift+F11` |

The advanced breakpoint input accepts semicolon-separated options, for example:

```text
instance=MAIN.Pump2; Counter>=10; change=Counter; hit=100
```

An omitted instance applies to all instances for a plain or hit-count breakpoint. A condition or break-on-change
requires an explicit instance because the flattened variable IDs identify concrete storage.
`instance=current` selects the context of the current halt.

## Modbus protocol extension

Custom function `0x46`, protocol version `1`, adds commands:

| Command | Value |
| --- | ---: |
| Step Over | 7 |
| Step Out | 8 |
| Set extended breakpoint | 14 |
| Clear extended breakpoint | 15 |
| Read logical call stack | 16 |

The extended breakpoint request payload is fixed at 37 bytes: Statement ID, Instance ID, flags, condition operator,
condition type/ID/size/value (8-byte slot), change type/ID/size and hit target. The call-stack response starts with
an 8-bit frame count followed by 12 bytes per frame (`pou_id`, `instance_id`, `statement_id`), all in network byte
order. Typed values remain native little-endian.

## Automated evidence

- MatIEC GREEN regression still proves deterministic debug output and hook-free production output.
- MatIEC YELLOW integration compiles `MAIN` with two `FB_PUMP` instances, an array and a structure; it verifies
  pointer-aware ENTER/LEAVE hooks, POU metadata and flattened variable records.
- TypeScript tests verify stable instance IDs, concrete C addresses, readable array/structure paths, generated
  instance resolution, protocol byte layout and call-stack decoding.
- Portable C runtime tests verify Step Into across an FB call, Step Over, Step Out, logical stack frames,
  Pump2-only breakpoints, a typed condition plus hit target, and break-on-change.
- The M7 parser test verifies every YELLOW request/response byte against a fake versioned PLC interface.
- ARM GCC compiles the embedded runtime with `-Wall -Wextra -Werror`.
- Electron main and renderer production builds complete successfully.
- The complete M7 Debug firmware builds with zero warnings and zero errors.

## Hardware acceptance checklist

1. Build and upload the instrumented two-pump test program.
2. Break in `FB_PUMP` for all instances and verify alternating `MAIN.Pump1`/`MAIN.Pump2` context.
3. Restrict the same breakpoint to `MAIN.Pump2` and verify Pump1 no longer halts.
4. At a call in MAIN, verify F11 enters `FB_PUMP`, F10 remains in MAIN and Shift+F11 returns to MAIN.
5. Verify stack order and Pump2 Locals, including `Counter`.
6. Verify `Counter>=10`, `change=Counter` and `hit=100` independently.
7. Verify array/structure values in Locals and normal Watch/Force behavior from GREEN.
8. Disable debugging and verify the normal production build/upload and PLC scan behavior.

YELLOW is not merged or tagged until this target-side checklist has been confirmed. Work stops before RED.
