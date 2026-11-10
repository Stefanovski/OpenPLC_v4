# Eurosonic OpenPLC 4.2.11-d9

Release date: 2026-11-10

## Changes

- Native C++ function blocks for Eurosonic targets, using setup() once per instance and loop() on each invocation.
- IEC inputs, outputs, IN_OUT, local, temporary and external variables are available by name; elementary types and arrays are supported.
- Instance state, IEC forcing and native-source program identity are preserved.
- Global C++ constructors/destructors are rejected because the PLC loader does not execute them.
- Existing non-Eurosonic generators and the PLC I/O memory map are unchanged.

## Limits

C++ is available for function blocks. The IEC debugger observes interface variables but does not step through native C++ source. User-defined IEC types and nested function blocks in the C++ interface are not supported. Arduino/OS APIs and heap allocation are not provided by the bridge.

## Validation

- Six regression suites: 41 tests passed.
- TypeScript application check with --skipLibCheck passed.
- Production main/renderer builds and ESLint for new TypeScript modules passed.
- Windows x64 NSIS installer built successfully; packaged version, adapter and compiler resources verified.
- Installer execution/installation was not performed during packaging.
- ARM production and debug compile/link checks passed.
- No-C++ baseline binary is byte-identical before/after adapter cleanup.
- Unsupported global C++ constructors are rejected before linking.
- User-reported successful manual C++ integration smoke test on the controller.
- See eurosonic-cpp.md for architecture, usage and automated ARM validation.

## Distribution

Windows x64 installer: OpenPLC Editor_4.2.11-d9.exe.
Git tag: eurosonic-openplc-v4.2.11d9.
This release is prepared locally; no GitHub Release publication is included.
