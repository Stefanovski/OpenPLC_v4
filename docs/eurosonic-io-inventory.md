# Eurosonic IO inventory and manual scan

Configuration > Board Settings includes an IO inventory panel for
Eurosonic_Gen2 targets. It reads physical slots 1..7 using the same firmware
metadata contract consumed by ES_GEN2_APP. A separate short-lived Modbus TCP
connection (port 502, unit ID 1, FC04 only) leaves debugger connections intact.
The read-only path sends no output, mode, flash, upload or firmware configuration command.
The explicit scan/activation path is described below.

## Sources and addressing

Verified against ES_GEN2_APP README.md and lib/features/generator/models/
io_module_state.dart, and ESSTM_H7_M7 docs/IO_MODULE_REGISTERS.md,
src/CModuleInventory.h and src/CFieldbusModule.h. Metadata for slot s is at PDU address 1094+(s-1)*100, six words:
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
Read inventory only refreshes it. There is no background hardware discovery.
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

## Manual scan and activation

The single **Read hardware…** button opens a choice:
- **Read inventory only** retains the FC04-only behavior, including older firmware.
- **Scan and activate** explicitly starts a scan in matching M7 firmware and then
  reads the resulting inventory. The dialog names the target IP and explains that
  new outputs immediately follow current PLC output values. Cancel does nothing.

This is an additive scan for cards powered after boot, not general hot swapping.
Known slot identities, process addresses, the expected project layout, unsaved
code, PLC mode and debugger sessions are retained. Firmware accepts DIO/AI/AO
payloads of 1/4/5 registers. Different cards in known slots or unsupported payloads
reject the whole addition. Missing known cards remain visible as communication
loss. No compile, save, download, PLC start/stop or automatic refactoring occurs.

New cards participate in the same FPGA/PLC IO synchronization as boot-detected
cards. Anybus/PROFINET mappings remain immutable until the next generator boot;
the result lists these PLC-only slots. The scan is not exposed to Codex/MCP.

Transport: independent Modbus TCP connection, unit 1, custom FC 0x47, protocol v1.
A read-only status probe precedes a single START with a random nonzero request
ID; bounded polling waits for that ID, then seven FC04 reads refresh the panel.
There is no automatic START retry after a timeout. Old firmware receives no START.
If the connection fails after START, activation may have completed; the UI marks
old data stale and asks for a read before retrying. Firmware requires an authenticated ESAPP/WebApp or OLED session with the
configured PLC run-mode write permission (reference 43001, normally role 2).
An OLED or open configuration menu is not required. General Modbus register
permissions remain unchanged. No new stored credentials are used.
Protocol details and firmware tests: companion M7 `docs/IO_RESCAN.md`.

### Hardware acceptance (requires the new M7 image)

1. Use a safe test setup with the ESDIO supply off at generator boot. Keep the
   existing PLC project; use a known blink output in that card's slot.
2. Open Read hardware… > Read inventory only: the slot must be empty.
3. Supply the ESDIO and wait for card startup. A read alone still shows the cached
   inventory. Choose Read hardware… > Scan and activate and confirm the target.
4. Verify the slot, communication OK and channel addresses. The PLC blink must
   reach the real LED/output without another PLC download. Check other modules,
   all configured PLC task periods and debugger observation remain functional.
5. Repeat the scan: no new modules, no duplicated mapping or changed addresses.
6. Remove only the test card's supply: the known module must show communication
   loss. Restore it: the existing module recovers without a new object/scan.
7. Confirm reading/cancelling does not change project files or unsaved code.

Automated rescan validation uses simulated devices. Subsequent physical
late-power recovery was verified on 2026-11-21 as summarized below; worst-case
production cycle timing remains a separate measurement.

Local validation for manual rescan: the existing 70 suites (584 tests) passed;
the two new suites (18 tests) passed after fixing their test setup. TypeScript
with skipLibCheck, targeted ESLint and production main/renderer builds passed.
The companion M7 native handler test and Debug build also passed. These automated checks did not flash firmware or activate real outputs.
Subsequent ST-Link device testing is recorded in the companion M7
`docs/IO_RESCAN.md`. The real cold-start/late-power test passed for AO slot 1
and AI slot 3 while DIO slot 2 remained active. ESAPP authentication worked
without an OLED; analog input/feedback data reached the process image, repeated
scans added nothing, and the operator confirmed unchanged DIO blinking. The
actual TypeScript rescan service also passed against the device. The PLC flash
region remained byte-identical. No nonzero analog output command or calibrated
analog measurement was performed.
