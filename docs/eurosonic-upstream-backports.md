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
| Integration branch | `20260821_MergeToOfficial` |
| Local safety tag | `eurosonic-gen2-2.11.0-working` |
| Package version in the fork | `4.0.7-beta` |
| Last official tag before the fork point | `v4.0.6-beta` |
| Actual upstream fork point | `8516dad1e62fb2b8c31287a941f0ef355fc35141` |
| First later official release | `v4.1.0` |

The package version is not the historical fork point. `v4.0.6-beta` is an ancestor, but the fork includes another 639 official commits and diverges at `8516dad1e` from 7 November 2025.

## Branch rules

1. Never merge, rebase, or cherry-pick into `development`.
2. Perform all evaluations and backports on `20260821_MergeToOfficial`.
3. Fetch `upstream`, but never run `git pull upstream development` on a Eurosonic branch.
4. Use `git cherry-pick -x` only for small, independent changes outside protected areas.
5. If a useful upstream commit touches a protected area, use it as a specification and implement the required behavior manually.
6. One upstream fix or one tightly coupled pull-request series per local commit.

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

The application version intentionally remains `4.0.7-beta`: this branch is the Eurosonic fork with selected
backports through official `v4.1.0`, not the complete official `v4.1.0` release.

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
