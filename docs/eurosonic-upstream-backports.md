# Eurosonic selective OpenPLC backports

## Objective

Keep the working `Eurosonic_Gen2 [2.11.0]` product behavior and selectively backport useful OpenPLC fixes and features. The official repository is a patch source, not a replacement base.

The following behavior is product-owned and must not be replaced implicitly:

- Eurosonic code generation and the generated runtime sources
- PLC linker layout (`0x081C0000`, maximum 256 KiB)
- `OPEN_PLC.bin` header, runtime MD5, and PLC program MD5
- TFTP upload, including first installation on empty PLC flash
- generator discovery and DHCP/static-IP configuration
- the existing Eurosonic configuration workflow
- debugger connectivity and forcing of BOOL and multi-byte values

## Frozen baseline

| Item | Value |
| --- | --- |
| Working commit | `68a5bf70cd20b5373f749864be827f50c686c138` |
| Working branch retained by the user | `development` |
| Integration branch pattern | `codex/sync-openplc-v<version>` |
| Local safety tag | `eurosonic-gen2-2.11.0-working` |
| Package version at the working baseline | `4.0.7-beta` |
| Current Eurosonic editor version | `4.1.4` |
| Last official tag before the fork point | `v4.0.6-beta` |
| Actual upstream fork point | `8516dad1e62fb2b8c31287a941f0ef355fc35141` |
| First later official release | `v4.1.0` |

The baseline package version is not the historical fork point. `v4.0.6-beta` is an ancestor, but the fork includes another 639 official commits and diverges at `8516dad1e` from 7 November 2025.

## Branch rules

1. Never merge, rebase, or cherry-pick upstream changes directly into `development`.
2. Create one integration branch from `development` for each official tag.
3. Fetch `upstream`, but never run `git pull upstream development` on a Eurosonic branch.
4. Use `git cherry-pick -x` only for small, independent changes outside protected areas.
5. If a useful upstream commit touches a protected area, use it as a specification and implement the required behavior manually.
6. One upstream fix or one tightly coupled pull-request series per local commit.
7. Merge the integration branch into `development` and create the Eurosonic tag only after the acceptance gate passes.

## Protected areas

| Area | Current locations | Integration rule |
| --- | --- | --- |
| Code generation | `src/main/modules/compiler/compiler-module.ts`, `resources/sources/eurosonic/` | Manual review and full compilation gate |
| Board identity | `resources/sources/boards/hals.json` | Preserve `Eurosonic_Gen2 [2.11.0]`; never replace the complete file blindly |
| Upload | Eurosonic `builder.py` and TFTP path | No live upload during backport development |
| Discovery | `src/main/modules/discover/`, discovery dialog and preload bridge | Manual review with packet/device tests |
| Configuration | device configuration board and static-host components | Preserve the 4.0.7 Eurosonic workflow |
| PLC image format | `openplc.lds`, `postcompile.py`, generated `defines.h` | Verify address, size, header, and both MD5 values |
| Debugger | debugger clients, variable panel, generated `debug.c` | Verify MD5 handshake, BOOL force, and `%QW1200` force |

## Release tranches

Counts are relative to the previous listed release, except `v4.1.0`, which starts at the actual fork point.

| Release | Date | Commits | Changed files | Protected-path changes |
| --- | --- | ---: | ---: | ---: |
| `v4.1.0` | 2025-12-19 | 106 | 108 | 2 |
| `v4.1.1` | 2026-01-10 | 44 | 89 | 2 |
| `v4.1.2` | 2026-01-30 | 106 | 112 | 3 |
| `v4.1.3` | 2026-02-26 | 75 | 460 | 4 |
| `v4.1.4` | 2026-02-27 | 14 | 21 | 0 |
| `v4.2.0` | 2026-06-05 | 902 | 2163 | 9 |
| `v4.2.1` | 2026-06-07 | 3 | 1 | 0 |
| `v4.2.2` | 2026-06-08 | 26 | 71 | 0 |
| `v4.2.3` | 2026-06-10 | 31 | 38 | 0 |
| `v4.2.5` | 2026-06-12 | 4 | 7 | 0 |
| `v4.2.6` | 2026-06-15 | 26 | 29 | 0 |
| `v4.2.7` | 2026-06-19 | 17 | 29 | 0 |
| `v4.2.8` | 2026-07-03 | 96 | 132 | 0 |
| `v4.2.9` | 2026-07-25 | 104 | 294 | 0 |
| `v4.2.10` | 2026-07-28 | 6 | 17 | 0 |
| `v4.2.11` | 2026-08-11 | 128 | 298 | 0 |

The 4.1 releases are reviewed first. The architectural jump between 4.1.4 and 4.2.0 is evaluated feature by feature and is never merged as a whole.

## Completed `v4.1.0` tranche

The following upstream pull requests were applied as separate commits:

| PR | Change | Local commit |
| --- | --- | --- |
| `#453` | Vertically align parallel ladder elements | `049cdd596` |
| `#454` | Improve ladder collision detection | `4fb148c01` |
| `#455` | Fix variable auto-name incrementing | `ddd8c9e77` |
| `#456` | Fix nested interactive elements | `a786d8a86` |
| `#457` | Avoid unsafe highlighted-text rendering | `45804135c` |
| `#460` | Poll nested debugger variables | `a9cc2fd8c` |
| `#462` | Debug function-block instances | `0d4ed3d5a` |
| `#469` | Fix global-variable editing and XML generation | `85135b2b5` |
| `#475` | Warn about unsaved changes from Recent menu | `b2b016095` |
| `#480` | Preserve the POU file extension when renaming | `c37e81ad4` |
| `#482` | Fix bottom-panel tab selection | `cdb418195` |

The following changes were deliberately not applied:

- `#476`: C++/Python search support is outside the Eurosonic PLC workflow.
- `#474`, `#477`, `#483`, `#490`: official runtime status, version, logs, and polling are not used by the
  Eurosonic target.
- `#481`: touches Configuration, which remains a protected Eurosonic-owned area.
- `#489`, `#491`: official Modbus server and remote-I/O workflows are unrelated to the existing Eurosonic
  process image.
- Arduino, local simulator, licensing-only, and unrelated platform changes were excluded.

### MatIEC and xml2st

The real Eurosonic compilation path uses the platform compiler in `resources/bin`, not the legacy copy under
`resources/sources/eurosonic/bin`. The following compiler changes were applied:

| Upstream commit | Change | Local commit |
| --- | --- | --- |
| `1bbc76b5f` | MatIEC library array wrapper | `9649ad232` |
| `717d2d3d2` | MatIEC compiler binaries | `2cabd7587` |
| `7d3d815c7` | Final MatIEC compiler binaries for `v4.1.0` | `6326f4c38` |
| `85ded4189` | Windows `xml2st` binaries | `0165f20d6` |

The broad upstream xml2st delete/re-add sequence was not used because it conflicts with Eurosonic-modified
macOS `glueVars` templates. Only the tested Windows binaries were selected; the Eurosonic macOS files and the
Linux xml2st binary remain unchanged.

The old and new Windows pipelines were run on the same reference `plc.xml`. Both completed XML-to-ST, MatIEC,
debug generation, and GlueVars generation successfully. `POUS.c`, `POUS.h`, `LOCATED_VARIABLES.h`,
`VARIABLES.csv`, `Config0.c`, `Config0.h`, `Res0.c`, and `glueVars.c` were byte-identical. The only difference was
the semantically irrelevant order of generated debugger `switch` cases. Located variables still include
`%IW1000` and `%QW1200`.

Validation after the complete tranche:

- `npm run build:main`: passed
- `npm run build:renderer`: passed
- variables-panel Force Value regression test: passed
- no upload or hardware access was performed

### v4.1.0 variable-declaration compatibility correction

The first end-to-end project compilation exposed an incompatibility in PR `#469`: its parser expected located
variables as `name : type AT %address`, while existing Eurosonic project files use the established IEC form
`name AT %address : type`. The POU was consequently loaded without variables and XML generation emitted an empty
`<interface/>`.

The parser now accepts both forms to avoid data loss across editor versions. Serialization remains in the
established Eurosonic form. The regression test explicitly covers `%QW1200`. A fresh load of the reference
`main.ld` restores all nine variables, and the regenerated XML-to-ST-to-C-to-debug-to-GlueVars pipeline completes
successfully with `%IW1000` and `%QW1200` present.

The application version advances tag by tag after all changes relevant to the supported Eurosonic/STM32H7
workflow have been selected and accepted. Version `4.1.0` therefore denotes synchronization through official
OpenPLC tag `v4.1.0` for that product scope. The About dialog identifies the build as `Eurosonic Edition` and
shows the `Eurosonic_Gen2 2.11.0` generator target.

## Completed `v4.1.1` tranche

The following editor and debugger changes were selected from the official tag:

| PR / commit | Change | Local commit |
| --- | --- | --- |
| `#503` | Accept both located-variable declaration orders | already covered by `11a54a342` |
| `#508` | Allow text selection in console and PLC logs | `41ffeeb29` |
| `#505` | Keep ladder autocomplete synchronized during keyboard selection | `0b64dff1c` |
| `#512` | Keep array modal popovers visible and editable | `ca1f0956c` |
| `#514` | Preserve custom-type spelling when creating variables | `8e11b1e32` |
| `#515` | Close autocomplete on Enter without creating an unintended variable | `0a711477c` |
| `#516` | Correct custom-type variable creation in FBD | `cef94ab89` |
| `#520` | Support all variable types in the global-variable debugger | `62f0e2cf2`, `feba8e88c` |
| `#523` | Persist selected global and POU debug variables | selective implementation `0da25a723` |

PR `#523` was applied selectively. Debug selections are stored in `project.json` and restored when the project is
opened, but the official relocation of `compileOnly` into the device configuration was deliberately omitted. The
existing Eurosonic Configuration data model and save format therefore remain unchanged.

The following changes were deliberately not applied:

- `#492`: its effective changes target the official server/remote-device explorer branches, which are not part of
  the preserved Eurosonic Configuration UI.
- `#499`: changes only the serial Modbus RTU debugger transport; the Eurosonic generator uses Modbus TCP.
- `#506`: replaces and extends the official Modbus-slave Configuration data model.
- `#518` and `3ee70d82b`: Arduino Mega and ESP8266 changes.
- `#523` compile-only persistence: omitted as described above.
- Official runtime, simulator, and unrelated device changes remain excluded.

### v4.1.1 MatIEC and xml2st

The final official `v4.1.1` MatIEC binaries were selected for Windows, Linux, and macOS. The tested Windows
`xml2st` binaries were also updated. Eurosonic-modified macOS xml2st templates and the Linux xml2st binary remain
unchanged.

The current and `v4.1.1` Windows pipelines were run in isolation with the same `v4TestProject` XML. Both completed
XML-to-ST, MatIEC, debug generation, and GlueVars generation. `POUS.c`, `POUS.h`, `LOCATED_VARIABLES.h`,
`VARIABLES.csv`, `Config0.c`, `Config0.h`, and `Res0.c` are byte-identical. The new xml2st output retains
`%IW1000` and `%QW1200`; `glueVars.c` still maps them to `int_input_ptr[1000]` and `int_output_ptr[1200]` and adds
only guarded `OPENPLC_V4` compatibility support.

Validation after the complete tranche:

- `npm run build:main`: passed
- `npm run build:renderer`: passed
- ESLint on all 23 changed TypeScript/TSX files: passed
- located-variable and variables-panel Force Value regression tests: 4 passed
- isolated `v4TestProject` XML-to-ST-to-C-to-debug-to-GlueVars pipeline: passed
- no upload or hardware access was performed

Version `4.1.1` denotes selective synchronization through official OpenPLC tag `v4.1.1` for the supported
Eurosonic/STM32H7 workflow. It does not claim inclusion of excluded Arduino, simulator, official runtime, or
Configuration features.

## Completed `v4.1.2` tranche

Starting with this tranche, changes that apply cleanly and do not compromise protected Eurosonic behavior are
accepted even when they are not directly required by the generator workflow.

| PR / commit | Change | Local commit |
| --- | --- | --- |
| `#524`, `eba27017b` | Preserve the configured runtime IP and restore it into the debugger connection state | selective `6467f1c86`, `a83b36a7d` |
| `#533` | Fix Enter-key handling in Ladder autocomplete | `b2c1c98e0` |
| `#548` | Keep the selected Force Value target and correctly send non-BOOL buffers | merged with the Eurosonic Force implementation in `4410b6c44` |
| `#558` | Report failed variable creation from graphical autocomplete | `69b11d718` |
| `#559` | Preserve variable debug selection while switching declaration views | `690f141c9` |
| `#573` | Propagate renames to all FBD variable node variants | `e98f5eabb` |
| `#574` | Preserve global-variable code between tabs and improve task-name allocation | `8731c7a8f` |
| `#575` | Select FBD continuation variables by name rather than a shared node ID | `52985751e` |
| `#569` | Correct debugger batch-progress accounting | selective `695812cb7` |
| `#551` | Allow descriptive custom pin names | `6e31a1f47` |
| `#549` | Generate valid Python shared-memory structs with no inputs or outputs | `9c709d665` |
| `#555`, `305512001`, `#571` | Harden Monaco/Python-LSP initialization, diagnostics, and view-state handling | `ba62a65ee`, `20017b7aa`, `528e55de9` |

The following blocks were tested as full cherry-picks and then aborted without leaving changes:

- `#530` S7Comm server configuration conflicts with the Eurosonic project schema, the intentionally absent official
  server editor, `workspace-screen.tsx`, and the protected compiler module.
- The final OPC-UA feature merge `3aea6cc3c` conflicts with the compiler, project/editor/tab schemas, debugger tree,
  and several official server/remote-device components that are intentionally absent in the Eurosonic branch.
- `#568` log filtering conflicts with the existing workspace and PLC-log state models. It is UI convenience rather
  than generator/debugger core behavior, so the state models were not manually replaced.

Other excluded changes:

- `#543` and `#570` require the official remote-device architecture that is absent from the Eurosonic editor.
- `#554` replaces runtime and timing-stat polling across the protected Configuration/workspace path.
- The ESP32 USB portion of `#569` modifies `hals.json`; only its independent debugger correction was selected.
- GitHub Claude/release workflows were not copied because they could activate unwanted automation on the Eurosonic
  fork and are not application functionality.

There are no MatIEC or xml2st binary changes between official tags `v4.1.1` and `v4.1.2`.

Validation after the complete tranche:

- `npm run build:main`: passed
- `npm run build:renderer`: passed
- ESLint on all 21 changed TypeScript/TSX files: passed
- located-variable and variables-panel Force Value regression tests: 4 passed
- isolated `v4TestProject` XML-to-ST-to-C-to-debug-to-GlueVars pipeline: passed
- `%IW1000` and `%QW1200` remain in `LOCATED_VARIABLES.h` and map to `int_input_ptr[1000]` and
  `int_output_ptr[1200]`
- no upload or hardware access was performed

Version `4.1.2` denotes selective synchronization through official OpenPLC tag `v4.1.2` for the supported
Eurosonic/STM32H7 workflow. Features rejected because they require replacement of the Eurosonic architecture are
listed above rather than being implied by the version number.

## Completed `v4.1.3` tranche

The 75 official commits were split into independent editor/debugger fixes, external compiler updates, and large
Arduino/simulator or server-architecture changes. The following applicable changes were selected:

| Upstream commit / PR | Change | Local commit |
| --- | --- | --- |
| `51bd6e345`, `#579` | Dismiss menus correctly on Windows while connected to a runtime | `0180aa8d9` |
| `43fe2da1c`, `1fe6a2539`, `9e4bf8caf`, `e5b62af87` | Improve debugger chart ranges, cleanup, labels, active state, and dark-mode contrast | `79010ab63`, `9f856bca8`, `030320c31`, `0d0d9d527` |
| `77efaece8`, `764ce9635` | Display global and forced values consistently in graphical editors | `244284783`, `fec441893` |
| `4df51d993` | Mark Resource changes as unsaved after table edits or reordering | `1ea30e787` |
| `303b2b993`, `#609` | Restore function-block instance autocomplete after project reload | `15196bfa6` |
| `f65506b21`, `#610` | Transfer documentation when selecting an external global variable | `709cfc49f` |
| `992f6ad68`, `#612` | Persist the selected theme | `15fc8f210` |
| `bf4c5c387`, `#614` | Show online values for structured types and function-block instances | `c39eb38bd`, selective `2bb973a48`, `09fe5ba50` |
| `034753082`, `#616` | Correct names and types of extensible block inputs | `ef6265020` |
| `c9beb0c4f`, `#617` | Support array elements in Ladder/FBD variables and autocomplete | `744267700` |
| `2dc879607`, `#608` | Improve forcing for coils, contacts, scalar variables, and function-block members | `a655b23bc` |
| `2d7614e66`, `71ccc1eaa` | Serialize RTU requests, prevent overlapping polls, and increase debugger refresh rate | `f71fec231`, `4ab521e1e` |
| `6bdc914ff` through `75ac25ae7` | Update Windows xml2st to 4.0.3 and MatIEC to 4.0.9 for generic IEC-to-C fixes used by STM32H7 builds | selective `fee3ab210` |

The structured-debug change referenced an older upstream tree builder that does not exist in the Eurosonic branch.
Its path-resolution behavior was ported into the active tree builder and covered by a regression test. The array
autocomplete change was merged with the Eurosonic `T#100ms` literal correction so Enter still submits literals rather
than trying to create an illegal variable.

### v4.1.3 MatIEC and xml2st

The upstream on-demand downloader was not adopted. Eurosonic remains an offline-capable bundle with compiler
artifacts committed in `resources/bin` and the matching library committed in `resources/sources/MatIEC/lib`.

- Windows x64/arm64 xml2st was updated from 4.0.1 to 4.0.3.
- Windows x64/arm64, Linux x64, and macOS x64/arm64 MatIEC were updated from 4.0.4 to 4.0.9.
- These platform directories contain host-side code generators for STM32H7 output, not Windows/Linux PLC runtimes.
- MatIEC 4.0.10 was excluded because it adds TCP/UDP blocks for a runtime API that Eurosonic does not implement;
  MatIEC 4.0.11 adds only local-simulator support on top of that.
- The 4.0.9 non-Arduino library include path was adjusted to preserve the function-block declarations that the
  Eurosonic target exposed before the update.
- The existing Linux and Eurosonic-modified macOS xml2st artifacts remain unchanged.

The downloaded release archives were checked against the official SHA-256 values before extraction. The new Windows
pipeline completed XML-to-ST, MatIEC, debug generation, and GlueVars generation on the same reference `plc.xml`.
`POUS.c`, `POUS.h`, `LOCATED_VARIABLES.h`, `VARIABLES.csv`, `Config0.c`, `Config0.h`, and `Res0.c` are semantically
unchanged; differences in generated debug output are limited to switch-case ordering and Arduino-only guarded code.
`%IW1000` and `%QW1200` still map to `int_input_ptr[1000]` and `int_output_ptr[1200]`.

The following changes were deliberately not applied:

- The Arduino Uno Q and ESP32 changes, including the 41-file Uno Q squash that mixes board support with compiler,
  Configuration, server, and file-watcher changes.
- The complete local AVR simulator series and MatIEC 4.0.11 simulator stubs.
- MatIEC 4.0.10 and `TCP_CONNECT.UDP`; these target a Linux-style socket runtime. A future H7 port would first need
  explicit Eurosonic implementations of connect/send/receive/close plus hardware tests.
- OPC-UA scrollbar, server/remote-device rename, alias, and Modbus-label changes because their official editor
  architecture is intentionally absent from the Eurosonic branch.
- The external-binary downloader and release-workflow changes because they remove the offline compiler bundle and do
  not verify release checksums or the presence of the MatIEC library.
- Documentation and GitHub workflow-only changes. There is no independent S7Comm feature change in this tranche.

Validation after the complete tranche:

- `npm run build:main`: passed
- `npm run build:renderer`: passed
- development renderer Webpack build with `ts-loader`: passed
- TypeScript source check with `--skipLibCheck`: passed; the unfiltered check still reports dependency declaration
  incompatibilities from `node_modules`
- ESLint on all 57 changed TypeScript/TSX files: passed with no errors (29 existing RTU `SerialPort` type warnings)
- debugger, Force Value, IEC-variable, and structured-path regression tests: 6 passed
- isolated `v4TestProject` XML-to-ST-to-C-to-debug-to-GlueVars pipeline with xml2st 4.0.3 / MatIEC 4.0.9: passed
- `%IW1000` and `%QW1200` remain present and retain their process-image indexes
- the final ARM CMake link remains blocked by the previously documented local CMake compiler-ABI hang
- no upload or hardware access was performed

Version `4.1.3` denotes selective synchronization through official OpenPLC tag `v4.1.3` for the supported
Eurosonic/STM32H7 workflow. Excluded simulator, Arduino, and absent official server-architecture changes are listed
above rather than being implied by the version number.

## Completed `v4.1.4` tranche

The 14 official commits changed only 21 files and contained no Configuration, Eurosonic upload/discovery, PLC image,
MatIEC, or xml2st changes. The applicable debugger and STM32H7 code-generation changes were ported into the existing
Eurosonic architecture:

| Upstream commit | Change |
| --- | --- |
| `11d5fe955` | Register FBD function outputs and keep forced variables in the debugger polling set |
| `69e074f69`, `c533d4dbc` | Display live non-BOOL variable and function-output values in LD/FBD |
| `6a06cd509` | Share the lowercase PLC base-type type used by debugger registrations |
| `aabaab625` | Poll the selected function-block instance using its hosting program and full instance path |
| `158fee1f5`, `fbd72b26d`, `e1164f6a4` | Resolve array elements, IEC lower bounds, and external-array paths in the active Eurosonic debugger tree |
| `390391273`, `0416094ad`, `fbd72b26d` | Support C++ block arrays with correct MatIEC wrapper stride and copy-back semantics |

The following changes were deliberately not applied:

- The simulator MD5-endianness part of `11d5fe955`; Eurosonic debugging talks to the STM32H7 target and does not use
  the local AVR simulator.
- Python function-block arrays and their shared-memory runtime. That implementation requires a host OS process and
  is not portable to the bare-metal STM32H7 generator target.

There are no MatIEC or xml2st changes between official tags `v4.1.3` and `v4.1.4`.

Validation after the complete tranche:

- `npm run build:main` and `npm run build:renderer`: passed
- development renderer Webpack build with `ts-loader`: passed
- TypeScript source check with `--skipLibCheck`: passed
- ESLint on all changed TypeScript/TSX files: passed
- complete unit suite: 8 suites and 67 tests passed
- isolated `v4TestProject` XML-to-ST-to-C-to-debug-to-GlueVars pipeline: passed
- `%IW1000` and `%QW1200` still map to `int_input_ptr[1000]` and `int_output_ptr[1200]`
- synchronized M7 Debug and Release builds: passed with zero warnings and errors
- linked PLC entry points and the 1024-byte image header verified at their fixed addresses
- no upload or hardware access was performed

Version `4.1.4` denotes selective synchronization through official OpenPLC tag `v4.1.4` for the supported
Eurosonic/STM32H7 workflow. It does not imply adoption of the excluded simulator or Python host-runtime behavior.

## Completed `v4.2.0` tranche

Official `v4.2.0` replaces the editor architecture and, from commit `2a857a0b6`, replaces MatIEC with STruC++.
That compiler/debugger/runtime migration is not wire-compatible with the existing Eurosonic M7 contract. The tag was
therefore treated as a functional inventory and only isolated fixes that fit the existing architecture were ported:

| Upstream commit | Change | Local commit |
| --- | --- | --- |
| `a47858dd7`, `e4963770f` and lifecycle follow-ups | Display cached ST/IL inline debug values without rescanning on every poll | `89956b516` |
| `9dd8cc203` | Undefine generated C/C++ block port macros between blocks | `235acf63c` |
| `b2cb93fde` | Stop the FBD divergence state from causing an infinite render loop | `4ba678614` |
| `9f1328980` | Match user-defined types case-insensitively in autocomplete | `1597d51b6` |
| `975b79374` | Keep watched nested and array values in the debugger polling set | `c64101b25` |
| `0f1bcfc6e`, `22791411f` | Resolve nested `ANY_*` types used by EQ/NE/LT/GT/LE/GE without crashing | `d17387eeb` |
| `3c1887dae` | Keep xyflow from consuming Space inside Monaco's EditContext editor | `d17387eeb` |
| `afe0f0d37` | Normalize legacy Ladder `connectedVariables` before components read it | `d17387eeb` |
| `d828f1468`, `c12a00ca4`, `9b9ebc1a4` | Correct PLCopen string tags and omit invalid empty/BOOL-specific data-type initializers | `7faaa530c` |
| `fbaf0a6c8` | Reject unnamed FBD variable blocks before XML generation with an actionable error | `7faaa530c` |

The following changes were deliberately not applied:

- the complete `src2`/`src/frontend`/ports-and-adapters architecture migration;
- STruC++, Runtime v4, three-byte debug addresses, endian sentinels and MD5/debug-map protocol changes;
- VPP, EtherCAT, Arduino, local simulator, soft-PLC and host-only runtime changes;
- xml2st 4.0.4/4.0.5 and `--keep-structs`, which are coupled to STruC++ block resolution rather than the tested
  Eurosonic MatIEC rewrite;
- the broad save/history/multi-mounted-editor and POU-rename refactors, which require the new store architecture;
- polling-by-runtime-`lastIndex` and DT/DATE/TOD/WSTRING wire parsing changes, whose semantics belong to the new
  STruC++ debug map and would endanger the existing M7 protocol;
- large Ladder branch/layout changes whose prerequisite editor model is absent from this branch.

Validation after the complete tranche:

- `npm run build:main` and `npm run build:renderer`: passed
- TypeScript source check with `--skipLibCheck`: passed
- ESLint on the changed editor/util files: passed; the large legacy compiler module still reports its documented
  pre-existing lint debt when linted as a whole
- complete unit suite: 14 suites and 82 tests passed
- isolated `v4TestProject` XML-to-ST-to-C-to-debug-to-GlueVars pipeline: passed
- PLC program MD5 remains `e1e9f22a39e862638d43578813643df1`
- `%IW1000` and `%QW1200` remain in `LOCATED_VARIABLES.h`; GlueVars still links them as `__IW1000` and `__QW1200`
- all generated source artifacts match the reference after Eurosonic preprocessing except the already documented,
  semantically irrelevant debug switch-case ordering
- the direct ARM CMake link again stops in the previously documented local compiler-ABI detection hang
- no upload or hardware access was performed

Version `4.2.0` denotes selective synchronization through official OpenPLC tag `v4.2.0` for the supported
Eurosonic/STM32H7 workflow. It explicitly does not claim adoption of the incompatible STruC++/Runtime-v4 platform.

### Eurosonic M7 runtime contract

The generated PLC module and the M7 application are separate binaries. They are synchronized through this narrow
ABI contract rather than by copying the complete runtime directories:

| Contract item | Value |
| --- | --- |
| PLC flash / image header | `0x081C0000`, 1024 bytes |
| `init_plc` entry point | `0x081C0400` |
| `run_plc` entry point | `0x081C0500` |
| debugger function table | `0x081C0600` |
| program artifact | `OPEN_PLC.bin` |
| process image | BOOL/WORD I/O pointers in DTCM, memory words in PLC SDRAM |

`FlashHeader_t`, the linker script, post-processing and the H7-relevant MatIEC declarations must remain compatible
with `ESSTM_H7_M7`. The M7-owned `hw.c`, loader task, Modbus server, Profinet integration and direct-I/O behavior
must not be replaced with the Editor template implementations.

## Acceptance gate for every backport

1. Editor production build succeeds.
2. Architecture/lint/unit checks relevant to the changed files succeed.
3. The reference project opens without migration or data loss.
4. `Eurosonic_Gen2 [2.11.0]` remains selectable with the existing configuration fields.
5. Generated IEC/C artifacts retain the expected located variables.
6. PLC image begins at `0x081C0000` and stays within 256 KiB.
7. Image-header runtime MD5 and PLC program MD5 are valid.
8. No upload occurs during automated checks.
9. On an explicitly authorized hardware test: update with existing PLC, first update with empty PLC, debugger connection, BOOL force, and `%QW1200` force all succeed.

## Reference baseline

Generate a read-only JSON snapshot with:

```powershell
powershell -NoProfile -File scripts\eurosonic\Export-EurosonicBaseline.ps1 `
  -ProjectPath C:\Temp\Sicherungen\v4TestProject
```

The current stored project has generated sources newer than its last successful `OPEN_PLC.bin`. Until a new build is produced through the known working Editor workflow, source hashes and binary hashes must be treated as separate reference sets.

The direct standalone CMake attempt also exposed a local Ninja/CMake ABI-check hang. GCC, `arm-none-eabi-ar`, and `arm-none-eabi-ranlib` work independently; no production build script has been changed while investigating it.


## Selective v4.3.0 tranche (2026-11-10)

Base: Eurosonic d9, `fe7174c22`. Initial integration branch: `codex/sync-openplc-v4.3.0`.
On 2026-11-12 the pending changes were preserved on the new acceptance branch
`codex/upstream-v4.3.0-safe-features`. Merge remains deferred until manual acceptance.
Official comparison: `v4.2.11..v4.3.0`; v4.3.0 resolves to
`5adb180f1759656410ca5ba320a96c8a87ad3317`. The range contains 443 non-merge commits
and changes 662 files. This is a selective behavior port, not adoption of the
upstream architecture or a claim of full v4.3.0 compatibility.

### Adapted behavior

| Upstream reference | Local adaptation |
| --- | --- |
| `aaec22ad0`, `db395df26`, `76d1aca1b` | Case-insensitive local/global name collisions and automatic name allocation; allow a case-only rename of the same variable; reject duplicates in declaration text before it reaches the store. |
| `e967a4fc0`, `1a58b1fa4` | Parse inline multi-dimensional arrays into our structured type model, reject empty dimensions/misplaced commas, and serialize actual array dimensions. Preserve both existing located-variable declaration spellings. |
| `6225b76f8` | Wait for all configuration writes to settle before reporting failure. Write project metadata only after POU contents succeed; do not delete obsolete POUs when a preceding content write fails. Accept a native project.json path on Windows. |

The editor backports were adapted to the existing main/renderer architecture
and leave the runtime and compiler resources unchanged. The branch also
contains the separate Eurosonic PLC storage integration described below. The
editor version remains d9 pending a separate release request.

Saving is not a filesystem transaction: successful individual writes are not
rolled back on a later error, and this change does not guarantee recovery from
power loss. The automated tests exercise write ordering, delayed failures,
metadata preservation and suppression of obsolete-file deletion.

### Deferred changes

- Save As, PDF export and graphical-editor model changes need their own UI and
  project-roundtrip work; they are not included in this limited tranche.
  Save As was reviewed again on 2026-11-12: the existing save action also marks
  editor files saved and clears pending POU deletions. Reusing it for another
  destination requires separate handling of unsaved variable text, open editor
  paths and project switching. Enabling the currently disabled menu item alone
  would not provide a safe project copy.
- Upstream's native C++ type completion depends on the STruC++ language server.
- STruC++ migration, runtime-v4 protocol, retain support, source retrieval from
  PLC, OPC-UA/S7 and board/licensing flows are not compatible drop-in changes.
- No upstream source licensing headers were removed or rewritten; any future
  direct source import must retain its applicable license notices.

### Manual acceptance in the development editor

Use a copy of the PLC test project. Start this branch with `npm run start:dev`;
the previously built d9 installer does not contain this tranche.

1. In an ST POU's variable text view, declare:

   ```iecst
   VAR
       Samples : ARRAY[-1..1, 2..3] OF INT;
   END_VAR
   ```

   Switch to the table and back. Both dimensions and the INT element type must
   remain. Use `Samples[-1, 2] := 42;` in the ST body, compile, save, close and
   reopen the project. Confirm the array remains intact.
2. Try `ARRAY[0..1,] OF INT` and `INT, DINT`: neither may be accepted as a valid
   type. Restore the valid declaration before saving.
3. Declare `Motor : BOOL;` and `motor : BOOL;` in the same variable text view:
   expect a duplicate-name error. With only Motor present, a table rename to
   motor must succeed. Renaming a different local/global variable to MOTOR must
   fail; creating a new name must allocate a non-colliding name.
4. Save changes to two POUs, reopen the project and check both bodies plus the
   task/device configuration. Do not simulate disk faults on the working project;
   delayed-write and disk-full conditions are covered by mocked I/O tests.
5. Compile the existing ST/FBD/LD project and CppBlink. On a suitable test device,
   verify the existing %QX120.6 blink, IEC watches and force/release behavior.
   No automated validation here uploads code or writes to hardware.


### Validation of this tranche

- Rechecked on `codex/upstream-v4.3.0-safe-features` on 2026-11-12:
  all 31 Jest suites / 176 tests, TypeScript (`--skipLibCheck`) and
  `git diff --check` passed. Production and ARM results below are from the
  preceding validation of the same production source changes.
- Full Jest suite: 31 suites, 176 tests passed.
- Save-failure tests rechecked after test-only lint corrections: passed.
- TypeScript application check (`--skipLibCheck`): passed.
- ESLint on changed production modules and tests: passed (new save tests fixed
  and rechecked separately after the first lint run).
- Production main and renderer builds: passed.
- Native C++ execution and ARM production/debug compile/link checks: passed.
- No-C++ baseline: 3520 bytes, SHA256
  `582bd5e315274bd88e9710d9bd1358dccbb7dd1e899cdd7a755839c25afca754`,
  identical to the d9 baseline. Global-constructor rejection also passed.
- `git diff --check`: passed.
- On 2026-11-18 the editor accepted and compiled the two-dimensional array
  after switching between text and table, saving, and reopening the project.
  It rejected the malformed declaration and the case-insensitive duplicate,
  and accepted a case-only change. Changes in two POUs survived reopening
  with the task, board, and pin configuration intact.
- The Eurosonic 8 kW test board ran the existing ST, FBD, LD and C++ blocks.
  The IEC debugger forced and released the BOOL and INT test outputs.
- Switching projects with the IEC debugger running can leave the old
  reconnect loop active. Disconnect the debugger before switching projects.

### Eurosonic PLC storage integration

Local `VAR RETAIN` declarations survive editor save and PLCopen export.
The M7 stores up to 704 bytes of RETAIN data in redundant FRAM records.
The asynchronous `plc_storage.h` file API accesses the existing QSPI LittleFS
under `/plc/recipes/` and `/plc/logs/`. For `/web/recipes/` support and the
atomic replacement and HTTP retrieval example, see the
[GEN2 LittleFS file API and recipe publishing guide](eurosonic-cpp.md#gen2-littlefs-file-api-and-recipe-publishing).

New Eurosonic PLC images on this branch require a matching M7 build that
binds the storage interface. Without that binding the PLC cycle returns
before executing the program, even for projects that use no storage. A version
label alone does not establish compatibility with an existing M7 build.
Older PLC binaries can still run on the new M7.

On 2026-11-18, the hardware test restored the retained counter and read a file
created before restart. A separate C++ test appended a second entry and read
both entries in order after a hardware reset. Host tests cover interrupted FRAM
writes, corrupted records, and preservation of the other FRAM regions.

## Save As adaptation (2026-11-19)

Branch: `codex/upstream-v4.3.0-next-features`, based on development `051add70e`.
This supersedes the Save As deferral above. Behavior references: upstream
`c849309d7`, `605ccc39b`, `c44cc6054`; implementation adapted to the existing
Eurosonic stores and project serializer, without adopting the upstream runtime.

File > Save As (Ctrl+Shift+A; Cmd+Shift+A on macOS) asks for a **new folder name**.
It writes the current project model, device configuration, pin mapping and all
POUs. It does not save the original first. Existing files/folders and destinations
inside the source project are rejected, including paths through junctions.
The reserved folder name `project.json` is rejected to avoid the existing save
service's file-versus-directory ambiguity.

Pending React editor updates and focused inputs are flushed before snapshotting.
Raw POU variable text is preserved, including incomplete declarations. Global
declarations must parse successfully because the project format stores them as
structured data; invalid text leaves the open project untouched. Current FBD/LD
flows are taken directly from the flow stores. Successful adoption rebases open
file/tab/editor paths while preserving editor models and undo history. Edits
made during the write are retained and leave the adopted project dirty. A
different project opened during the operation is not replaced. Cancel and write
failure never adopt the destination or mark the source saved.

This saves project sources, not a recursive directory backup: generated build
artifacts, arbitrary extra files and installed library packages are not copied.
The project name stays the same. A failed write may leave an incomplete new
destination; it is not deleted automatically, and a retry needs another new
folder name. This is not a power-failure-safe filesystem transaction.

### Automated coverage

The Save As suites use disposable filesystem fixtures (never the user's PLC
project), real POU serialization and the real project reader. They cover original
file preservation, ST/C++/FBD/LD roundtrip, subsequent normal save to the copy,
cancel, existing destinations, source containment, junctions, path traversal,
write and history failures, pending declarations/flows, changed state during I/O,
project switching, IPC failure/retry and duplicate Save As requests.

Validation on 2026-11-19: full Jest suite passed (33 suites / 201 tests).
After adding the final reserved-folder-name guard, both Save As suites passed
again (25 tests). Final TypeScript check (`--skipLibCheck`), ESLint on all changed
TypeScript files and production main/renderer builds passed; main was rebuilt
after the final guard. `git diff --check` passed. Native dialog and focused-input
interaction still require the manual editor acceptance below.

### Manual editor acceptance

1. Run `npm run start:dev` on this branch and open a disposable project copy.
2. Edit an ST or C++ body and its variable declarations without saving. Use
   File > Save As, enter a new sibling folder name and cancel. Verify that the
   original path, edited content and unsaved indicator remain.
3. Repeat and save to a new sibling folder. Verify the new project path, retained
   open editors and undo functionality. Edit again and use normal Save; only the
   new project must change. Reopen the new project and verify the contents.
4. Repeat via Ctrl+Shift+A while the caret is still in a variable declaration or
   table input. Include global variables, device settings and an FBD/LD edit.
5. Attempt an existing destination and a destination inside the original project.
   Neither may be overwritten. Check the original project's files independently.
6. Compile the copied project including CppBlink. Hardware upload is a separate
   user-controlled acceptance step; these tests do not upload or flash anything.

No installer, version bump, commit, merge or push is part of this change.

## Print / PDF export (2026-11-20)

Backported the v4.3.0 print engine into `src/utils/print`, adapting its types to
our existing editor and adding a dedicated main-process print service. Upstream
attribution, GPL license and font licenses are retained alongside the imported
sources. PDF dependencies are pinned (`pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1).
No compiler, runtime, upload, hardware or debugger code is changed.

File > Print preview / PDF export, Page setup and Print (Ctrl+P) open the same
selection dialog. It supports A4/A3/Letter/Legal, orientation, margins, scale to
fit, POU selection, optional globals/tasks/data types and preview zoom. Export
writes a PDF only after choosing a destination; Print opens the native printer
dialog. Canceling either operation does not save the project.

Printing takes a detached snapshot of the current editor stores, including
unsaved text, raw incomplete declarations and current FBD/LD flows. It neither
parses declarations into the live project nor marks the project saved. Text
POUs (ST, IL, C++, Python), variables, FBD and LD are supported. SFC is rejected
explicitly; deselect it to export other POUs. Source text is monochrome rather
than dependent on the newer upstream language-server implementation.

Local corrections preserve in/out block pins, diagram labels above nodes,
wrapped diagram comments and long variable values. Preview and PDF share the
same paginated drawing operations. Preview HTML escapes project text and uses
a restrictive CSP and sandbox; printing uses a hidden isolated Electron window.
Input sizes, page dimensions and graph coordinates are bounded. Non-PDF export
destinations are rejected.

Validation: the complete Jest suite passed (47 suites / 342 tests), including
existing C++ and Save As coverage. The print suites were rerun after final
comment rendering changes. TypeScript (`--skipLibCheck`), ESLint and production
main/renderer builds were checked. An isolated Electron profile and disposable
synthetic project exercised opening the dialog through native IPC, generating
preview and exporting a real PDF. The real hidden print window also rendered
successfully through Chromium printToPDF (substituted for physical printing
only in the external test harness). Portrait/landscape PDFs with C++, ST, FBD,
LD, long text and Unicode were rendered and visually inspected. No user PLC
project, running debugger or device was used. A physical printer remains a
manual acceptance step.

### Manual print acceptance

1. Start the editor on this branch with `npm run start:dev`; open a project copy.
2. Change a C++ or ST body without saving. Press Ctrl+P, choose the desired POUs
   and click Create preview. Confirm that the change appears in the preview.
3. Use Export PDF, first cancel, then save to a separate `.pdf` file. Check the
   result in a PDF viewer. The editor's unsaved state and project files must
   remain unchanged.
4. Repeat with FBD/LD, a long comment, variables, landscape and Scale to fit.
5. Use Print and cancel the native printer dialog; then optionally print a page
   to a real printer. Close the preview and confirm edits and normal Save work.
6. Compile the test project as the final local regression check. Hardware upload
   remains a separate user-controlled acceptance step.

No installer, version bump, commit, merge or push is part of this backport.

### Original-style wizard and configuration tables (2026-11-20)

The initial combined print panel is superseded by the v4.3.0 wizard layout:
selection grouped into Functions / Function Blocks / Programs, separate page
options, then PDF preview. The modal uses the editor's existing theme and modal
components, with the original 92vw/92vh layout, button styles, page navigation
and zoom controls. SFC is excluded with an explicit notice. Configuration can
be selected independently of POUs. Back preserves selections and page options;
Cancel leaves the project unchanged.

Preview now renders the exact cached export PDF using the upstream PDF.js
canvas viewer, loaded only on demand. PDF.js 6.3.289 and its guarded Electron
compatibility helpers are taken from the same upstream tag. The existing
isolated native print window remains in place. No general editor, compiler,
upload or debugger interface was migrated.

Configuration is a dedicated print document, not a synthetic ST POU. It has
readable tables for globals, tasks, program instances, structure members,
array dimensions/base types and enumeration values. Values wrap; long tables
repeat section titles and column headers across pages. Empty sections say
None. Pending global declaration code remains verbatim to preserve even
incomplete unsaved edits; it replaces the potentially stale globals table.

The complete Jest suite passed (48 suites / 345 tests). New regressions cover
configuration formatting, source-state preservation and long table pagination.
Preview/export PDF identity is checked in the service test. For acceptance,
use Ctrl+P, choose POUs/configuration, Next, set page options, Next, then Export
or Print. Verify Back, Cancel, portrait/landscape, zoom and page navigation.

Final visual acceptance used an isolated Electron profile and disposable fixture
at 1280x900 and 1000x760 logical window bounds: grouped selection, page setup,
portrait/landscape PDF canvases, light/dark styling, zoom/reset and previous/next
navigation passed. Canceling export, exporting a real PDF and the hidden native
print window (Chromium PDF substituted for a physical printer) passed. Source
files were byte-compared before/after and stayed unchanged. The exported
configuration page was rendered separately and visually checked. Production
main/renderer build, TypeScript and ESLint passed. Physical printer acceptance
remains manual; no user device or debugger was connected.
