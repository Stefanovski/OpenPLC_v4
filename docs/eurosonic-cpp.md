# C/C++ function blocks on Eurosonic targets

This implementation applies only to boards with `compiler: eurosonic-cli`.
The Arduino/OpenPLC runtime generators, PLC memory map and M7 firmware are not
changed. Both ordinary compilation and debugger compilation select the same
Eurosonic C++ adapter.

## Using a block

Create a C/C++ **function block**, declare its IEC variables in the variable
table, and implement `void setup()` and `void loop()` (the `(void)` spelling is
also accepted). For example, declare `Input: INT` as input, `Output: INT` as
output and `Counter: INT` as local:

```cpp
void setup()
{
    Counter = 0;
}

void loop()
{
    ++Counter;
    Output = Input + Counter;
}
```

Instantiate and call this block from ST, FBD or LD like another function block.
`setup()` runs on the first enabled call of **each instance**, then `loop()`
runs on every enabled call, including that first call. The state resets when
the PLC program is initialized again. IEC local variables are the storage for
per-instance state; C++ `static` variables and globals have ordinary C++ shared
storage semantics, not one copy per IEC instance.

Inputs, outputs, `IN_OUT`, locals, temporary and external variables are exposed.
Temporary IEC variables retain MatIEC's reset-on-call behavior. `hasBeenInitialized`
is reserved for the bridge. Variable names in the C++ body are case-sensitive.
Use ordinary C++ helper functions with explicit arguments; mark file-local
helpers `static` to avoid exporting duplicate symbols from different blocks.
Put header includes before `setup()`/`loop()`.

## Supported interface and limits

- Elementary IEC types, including TIME/DATE/TOD/DT and STRING, and arrays of
  elementary types are supported. TIME uses `tv_sec`/`tv_nsec`; STRING uses
  `len`/`body` (the MatIEC representation, not `std::string`).
- Arrays keep their IEC index bounds: `ARRAY[-1..1,2..3] OF INT` is accessed as
  `Samples[-1][2]` through `Samples[1][3]`. Indices must remain in the declared
  range, as with ordinary native arrays. Their views are valid only during the
  current call and must not be stored for later use.
- The generated per-call interface snapshot, including its pointer table, is
  limited to **1024 bytes** by a C compile-time assertion. Native user code has
  its own additional stack requirements.
- IEC user-defined types and nested FB instances in the C++ interface are
  rejected explicitly. The legacy xml2st pipeline rewrites STRUCTs to FBs;
  treating that storage as an elementary IEC wrapper would corrupt memory.
  This is not upstream 4.3's complete IEC type-system integration. Ordinary
  C++ structures/classes within the native algorithm can be used independently.
- Global C++ constructors/destructors are rejected before linking, because
  the existing PLC loader does not run a C++ process startup/shutdown sequence.
  Initialize IEC instance state in `setup()` instead. Heap allocation, exceptions,
  OS APIs and Arduino APIs are not supplied by this bridge.
- IEC watches/forcing remain available. Source-level stepping *inside native
  C++* is not provided by the IEC debugger.

## Build and runtime contract

The editor produces an ST wrapper and keeps the original C++ source separately.
MatIEC compiles the wrapper to C. The backend then writes `c_blocks.h`, a
type-only header and one `src/eurosonic_cpp_<pou>.cpp` translation unit per block.
These files are picked up by the existing recursive CMake source glob and
compiled with ARM GCC/G++ into the same `OPEN_PLC.bin`.

The adapter uses typed temporary snapshots and MatIEC read/write accessors.
It does not hand native code unchecked write pointers to forced IEC variables.
Array copy-back checks both whole-array and element force flags. External
variables also respect the global force flag. `Config0.h` getter declarations
are included before generated POU initialization when native blocks are present.

Rebuilds replace generated source files rather than appending code. Removing
or renaming a C++ POU removes its stale translation unit. A project without C++
retains the empty `c_blocks.h` template and does not run the native-object check.
C++ source identity is encoded in an ST comment, so native-only edits change
the program MD5 used for upload/debug identity. C++ source is not inserted into
the controller binary as text by this mechanism.

## Reproducing validation

Run the focused regression suites:

```powershell
node node_modules/jest/bin/jest.js --runInBand --watch=false --coverage=false --runTestsByPath src/utils/cpp/eurosonic.test.ts src/utils/cpp/array-codegen.test.ts src/main/modules/compiler/eurosonic-plc-binary.spec.ts src/main/modules/compiler/iec-debug.spec.ts src/renderer/utils/iec-debug.test.ts src/renderer/utils/graphical-debug.test.ts
```

The native execution test needs the bundled Windows MatIEC compiler and the
existing local MSYS2 UCRT64 GCC/G++ under `.tooling/msys64/ucrt64/bin`; it is
explicitly skipped if those tools are absent. It leaves a generated fixture
under `.tooling/cpp-integration-*`.

For a full offline ARM compile/link/binary check, pass that fixture to:

```powershell
python scripts/eurosonic/test_cpp_arm.py .tooling/cpp-integration-<id>/fixture.json
```

The default uses the bundled xml2st executable. If its PyInstaller extraction
is blocked in the execution environment, pass `--xml2st-source <xml2st.py>` and
`--xml2st-python <python.exe>` for the local Eurosonic xml2st source checkout.
`--toolchain` can override the existing `C:/sysgcc/arm-eabi` default.

The ARM check exercises XML generation output, xml2st, MatIEC, generated C/C++,
runtime sources, the production linker script and binary postprocessing. It
checks ordinary and instrumented builds, the 256 KiB limit and header fields,
a byte-identical no-C++ baseline, and rejection of global constructors.
It invokes the ARM tools directly with the production flags, rather than
depending on Ninja subprocess pipes. This is not a hardware acceptance test.

## Validation on this branch

Native execution verified instance separation, one-time setup, temporary
variables, scalar and multidimensional array transfer, TIME/STRING, external
and IN_OUT variables, and force preservation. Two different C++ block types
with identical port and file-local helper names compile and run together.
All 41 tests in the six focused suites passed. Offline ARM production and
instrumented builds passed (7,296 and 13,024 bytes for the two-block fixture);
the no-C++ fixture produced byte-identical binaries before and after cleanup.
The Electron main and renderer production builds also passed.

The user reported successful C++ integration testing on the target on 2026-11-10.
This is a manual smoke test, not comprehensive hardware acceptance. The
complete TypeScript check reports dependency declaration incompatibilities;
the application check with `--skipLibCheck` passed. The existing ARM linker
reports its RWX load-segment warning for both native and no-C++ fixtures.
For this run, bundled xml2st extraction was blocked by the environment, so the
ARM pipeline used the local Eurosonic xml2st Python checkout. Ninja's compiler
probe did not finish in this environment; the offline ARM check therefore used
direct toolchain invocation as described above. Neither an interactive editor
upload nor the unchanged build.bat/Ninja execution was certified by this check.
