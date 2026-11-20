# Eurosonic IO inventory (first stage)

Configuration > Board Settings now includes a read-only inventory panel for
Eurosonic_Gen2 targets. It reads physical slots 1..7 using the same firmware
metadata contract consumed by ES_GEN2_APP. A separate short-lived Modbus TCP
connection (port 502, unit ID 1, FC04 only) leaves debugger connections intact.
No output, mode, flash, upload or firmware configuration command is sent.

## Sources and addressing

Verified against ES_GEN2_APP README.md and lib/features/generator/models/
io_module_state.dart, and ESSTM_H7_M7 docs/IO_MODULE_REGISTERS.md,
src/CModuleInventory.h and src/CFieldbusModule.h. No changes were made in those
repositories. Metadata for slot s is at PDU address 1094+(s-1)*100, six words:
version, ident low, ident high, register count, communication OK, module type.
Known types: 1 DIO, 2 AI, 3 AO. Ident is a model ID, not a serial number.
Unknown types are retained but have no invented channel map.

Physical channels are displayed as 1..8 (digital) / 1..4 (analog).
DIO channel c maps to %IX/%QX[100+(s-1)*20].[c-1]; analog maps to
%IW/%QW[1000+(s-1)*100+c-1]. AI exposes input words; AO exposes feedback input
and output words. Channel numbers are not terminal-block pin numbers; physical
terminal labels require a separate verified connector map. PROFINET slot
numbers (2..8) and Modbus displayed references must not be confused with these.

## Project versus detected layout

The optional `ioLayout` field in devices/configuration.json stores all seven
expected slots (slot, type, ident, registerCount). Existing projects without
this field remain valid. It is retained on load, normal Save and Save As.
`Use detected layout` opens an explicit confirmation, updates only the device
configuration and marks it unsaved. It does not save automatically or rewrite
PLC addresses. The detected snapshot remains transient.

The panel distinguishes match, missing/additional/different modules,
communication loss and unverified data. Failed/partial reads never replace the
last snapshot with an empty inventory. A snapshot expires after 30 seconds;
Read hardware refreshes it. No background polling or hot-plug scan is implied.
Firmware inventories cards at startup; its communication flag is not a
freshness counter. All-zero metadata cannot distinguish an empty installation
from older firmware without the metadata extension: it is displayed as
unverified and cannot be adopted. Valid version-1 occupied metadata verifies
the format. Communication failures prevent adoption.

Selecting a slot shows the project/detected channel maps and matching located
variables plus possible source/diagram address occurrences. This is preparation
for refactoring, not an exhaustive semantic reference graph: comments may be
included, aliases/computed addresses and pending global code are not resolved.
Automatic slot/channel remapping remains a separate feature with review, type
checks and undo; no regex-based rewriting is performed.

## Acceptance

1. Open an existing Eurosonic project; Configuration must show seven slots.
2. Enter the generator IP and choose Read hardware. Compare installed modules
   against the physical unit / ESAPP. Slot 2 DIO channel 1 is %QX120.0.
3. Select a slot to inspect addresses and affected references.
4. Cancel Use detected layout: no project change. Confirm it: only the expected
   layout changes; normal Save persists it. Reopen and verify it.
5. Open a copy with a different expected layout: missing/additional/different
   modules must be shown. Do not hot-swap hardware as part of this software test.
6. Disconnect the network or use an unreachable IP: no green match based on
   cached data and no adoption. Existing expected configuration remains intact.

Automated tests cover fragmented Modbus frames, exceptions/disconnects,
transaction validation, empty/unsupported metadata, slot/word ordering,
channel addresses, comparison states, optional schema roundtrip and store
loading/adoption. The complete suite passed: 51 suites / 356 tests.
TypeScript, targeted ESLint and the production main/renderer builds passed.
An isolated Electron UI test with a disposable project and simulated inventory
verified missing/additional modules, channel addresses, cancellation/adoption,
and disabled adoption after a failed read. Project files remained byte-identical
through these unsaved operations. The resulting panel was visually inspected.
Actual generator acceptance remains manual; local tests use simulated hardware.
