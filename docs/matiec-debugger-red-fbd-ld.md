# Eurosonic debugger RED: FBD and LD

## Scope

This stage completes the PC-side FBD/LD debugger on top of the existing GREEN and YELLOW IEC debugger.
SFC and Online Change are intentionally outside this stage. The STM32H747-M7 runtime and protocol are unchanged.

## Architecture

- `xml2st` retains the existing `(text, metadata)` chunks and emits `program.source-map.json` next to `program.st`.
- `ComplexParser.RewriteST()` carries source-line identity through structure rewrites. The source map is calculated from
  the exact on-disk, post-rewrite ST text; it does not search for similar text.
- The editor validates the PLCopen XML SHA-256, final ST SHA-256, source-map SHA-256, MatIEC debug-symbol SHA-256,
  every exact source span, and the existing target program MD5 before enabling graphical debug data.
- The PC joins `(POU, localId, kind, pin)` to final ST spans and MatIEC statement IDs. PLCopen IDs, graph topology,
  power flow, colors, and source maps never enter the target image.
- The visible FBD/LD graph produces a deduplicated watch plan. For blocks, only output handles connected in the
  visible graph are requested. Explicit watches and forced values remain active independently.
- Existing YELLOW `READ_MANY`, breakpoint, conditional/change/hit-count, step, call-stack, and instance IDs are reused.
  No FBD/LD-specific command or target state exists.

## Source-map verification

The current `v4TestProject` PLCopen file was generated once with upstream xml2st v4.0.7 and once with the local
Eurosonic fork. Both post-rewrite ST files are 2,338 bytes and have the identical SHA-256:

`ffed36896cc99c23559ce0e73eb580801af7493f0a683541c0fda4b716e90cdf`

The generated sidecar contains 153 chunks: 145 exact spans, five rewrite-only chunks, and three deliberately marked
content-changing chunks. It contains 38 graphical chunks for 19 unique `(POU, kind, localId)` elements and is 70,661
bytes. The sidecar describes the exact ST prefix passed to MatIEC; the existing debugger code appended afterwards is
excluded using the recorded byte/character length and hash.

## Online semantics

### FBD

- Input, output, and in-out variables use normal runtime variables.
- Function-block outputs use the selected concrete nested FB instance.
- Existing `_TMP_<FUNCTION><localId>_<OUTPUT>` values are reused for function results.
- Wires and connector/continuation chains are derived on the PC from their source sample.
- Negated BOOL variable pins are evaluated on the PC. Unknown or non-materialized function results are shown as
  `unavailable`; user functions and function blocks are never executed a second time on the PC.

### LD

- Left rail, series paths, and parallel merges are evaluated on the PC.
- Normal and negated contacts use sampled runtime BOOL values.
- Rising/falling contacts are marked `estimated` because a 50 ms editor poll can miss a one-cycle pulse.
- Coil input power and the actual runtime variable are kept separate. A visible mismatch marker covers negated,
  SET/RESET, and multiply-written coils.

Values use `sampled`, `estimated`, `stale`, `unavailable`, or `type-error` as appropriate. `exact-derived` is reserved
for data derived from a coherent snapshot; the current YELLOW response is intentionally not misrepresented as one.

## Reverse mapping and instances

Reverse lookup deterministically selects the binding whose breakpoint statement equals the halted statement as the
primary graphical source. Other overlapping bindings are retained as secondary sources and rendered less strongly.
Current highlighting requires the selected runtime instance ID to match the halted instance. Nested paths such as
`MAIN.Line1.PumpController.Timer1` are built directly from YELLOW metadata; the POU graph is not duplicated per
instance.

## Performance and target budget

The stable watch response costs one status byte plus nine descriptor bytes and the typed value bytes per anchor. At
the existing 50 ms poll interval, the following payload-only figures apply:

| Visible example                  | Graph elements |     Unique anchors | Response bytes | Maximum payload rate |
| -------------------------------- | -------------: | -----------------: | -------------: | -------------------: |
| `fbdtest` ADD + GT               |              7 | 7 (5 DINT, 2 BOOL) |             86 |            1,720 B/s |
| two LD timer rungs               |             10 |             6 BOOL |             61 |            1,220 B/s |
| synthetic 100-element BOOL graph |            100 |            12 BOOL |            121 |            2,420 B/s |

The figures exclude Modbus/TCP framing. More than 24 anchors, or a response above the protocol PDU limit, is spread
over bounded polls; requests never overlap.

Target delta caused by RED is deterministically zero:

| Budget                        |                                      RED delta |
| ----------------------------- | ---------------------------------------------: |
| M7 Flash                      |                                        0 bytes |
| M7 RAM                        |                                        0 bytes |
| PLC cycle without editor      |                      0 additional instructions |
| PLC cycle with FBD/LD visible | no RED hook; only existing YELLOW read traffic |

Absolute hardware cycle timings will be recorded during the joint target acceptance test. This implementation adds
no per-node/per-wire instrumentation, graph arrays, PLCopen parser, target-side graph traversal, or graphical protocol.
The production target binary receives neither the sidecar nor any RED metadata.

## Accuracy limits

- one-cycle edge pulses can be missed between polls;
- a cycle-end sample can contain a value written after the network currently displayed;
- unknown/impure functions are not reconstructed;
- nonpersistent function locals are unavailable after return;
- values from successive bounded requests are sampled, not a guaranteed single-cycle coherent snapshot.

These cases remain visible through quality status rather than hidden target instrumentation.

## Local forks

- OpenPLC branch: `codex/red-complete-fbd-ld-debug`
- xml2st branch: `codex/eurosonic-graphical-source-map`
- xml2st local commit: `67183884 feat(source-map): preserve graphical xml2st bindings`

Neither fork is pushed by this work. The bundled Windows x64 xml2st executable SHA-256 is
`aa687e9b8665abf0a9acedc12545608db1466dba8f5e02e666de4411278ec994`.
