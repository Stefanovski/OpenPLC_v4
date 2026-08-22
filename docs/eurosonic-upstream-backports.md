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
| Current Eurosonic editor version | `4.1.3` |
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
