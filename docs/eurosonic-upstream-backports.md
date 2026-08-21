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

## Initial `v4.1.0` candidates

These are review states, not approvals to integrate.

| PR | Change | Initial assessment |
| --- | --- | --- |
| `#453` | Vertically align parallel ladder elements | Low-to-medium risk; ladder/XML tests required |
| `#454` | Improve ladder collision detection | Low risk; UI-only candidate |
| `#455` | Fix variable auto-name incrementing | Very small, isolated candidate |
| `#456` | Fix nested interactive elements | Small UI/accessibility candidate |
| `#457` | Avoid unsafe highlighted-text rendering | Security-relevant; review with high priority |
| `#460` | Poll nested debugger variables | Useful but debugger-sensitive; manual test required |
| `#462` | Debug function-block instances | Large debugger change; manual port only if needed |
| `#469` | Fix global-variable editing and XML generation | Compiler/XML-sensitive; manual review |
| `#475` | Warn about unsaved changes from Recent menu | Small, isolated candidate |
| `#481` | Prevent hidden device form fields | One-line UI candidate; verify old configuration layout |
| `#482` | Fix bottom-panel tab selection | Small candidate but touches shared workspace state |

Changes for official runtime upload, runtime version detection, runtime logs, status polling, and the official remote-I/O workflow are not assumed to be relevant to the Eurosonic product.

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
