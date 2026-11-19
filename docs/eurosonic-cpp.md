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

## GEN2 LittleFS file API and recipe publishing

The Eurosonic OpenPLC runtime supplies `plc_file.h` when compiling for
`Eurosonic_Gen2` or a GEN2 board variant such as `Eurosonic_Gen2_8KW`. Include
it in the **C/C++ body** of a function block and call the file functions there.
In the test project, open the `StorageFileProbe` function block to see the
file calls. The `debugtest` program calls `Probe()` and exposes the result as
`FileTestStatus`. That probe opens, writes, closes and reopens a log file for
reading. The repository has the same native example in
[`storage_file_probe.cpp.txt`](../resources/sources/eurosonic/runtime/tests/storage_file_probe.cpp.txt).

The API uses the generator's QSPI LittleFS. It accepts paths under
`/plc/recipes/`, `/plc/logs/` and `/web/recipes/`. Only the last directory is
intended for browser recipes. Use `.json` for published recipes and `.tmp`
for staging files there. The staging path is also under the HTTP document
root, so treat it as public. Paths are case-sensitive and fit in 96 bytes
including the terminating zero. Each read or write transfers up to 256 bytes.

### Calling the file functions

Zero-initialize a `plc_file_t` object and keep it across PLC scans. `open`
stores the handle in that object. `read`, `write` and `close` use the same
object. `rename` and `delete` use the object to track the path operation,
including after the file has been closed.

| Function | Arguments after `&file` |
| --- | --- |
| `plc_file_open` | Path and `PLC_OPEN_READ`, `PLC_OPEN_WRITE` or `PLC_OPEN_APPEND`. Write mode truncates an existing file |
| `plc_file_read` | Destination buffer, capacity and pointer to bytes read. Zero bytes for a nonzero request means EOF |
| `plc_file_write` | Source buffer, byte count and pointer to bytes written. Check the reported count |
| `plc_file_close` | File object only |
| `plc_file_rename` | Source and destination paths. Replaces an existing destination file atomically |
| `plc_file_delete` | Path to remove |

Each function returns `PLC_STORAGE_OK` when finished, `PLC_STORAGE_BUSY`
while waiting, or a negative error code. On `BUSY`, return from `loop()` and
repeat the same call on a later scan with the same arguments. Outputs are
written on success. The service processes one operation at a time across
the PLC and supports two open files. Keep calling a busy operation until it
finishes so the service can accept the next one.

### Low-level file interface

Zero-initialize `plc_file_request_t`, fill its `operation` and the fields
below, then call `plc_file_submit(&request, &ticket)`. On `PLC_STORAGE_BUSY`,
retry the submission on a later PLC scan. On `PLC_STORAGE_OK`, keep the ticket
and call `plc_file_poll(ticket, &result)` on subsequent scans until it stops
returning `PLC_STORAGE_BUSY`. A successful poll consumes the completed result.
Check both return values. A negative submit or poll status is an API error,
and a negative `result.result` after a successful poll is a file operation
error. For example, LittleFS returns `-2` for a missing file. The service
allows one outstanding operation across the PLC and two open handles. Keep
polling an accepted request to completion instead of submitting it again.

| Operation | Set these request fields | Successful `result.result` |
| --- | --- | --- |
| `PLC_FILE_OPEN_READ` | `path` | Positive handle for an existing file |
| `PLC_FILE_OPEN_WRITE` | `path` | Positive handle. Creates the file or truncates it to zero bytes |
| `PLC_FILE_OPEN_APPEND` | `path` | Positive handle. Creates the file if needed and appends writes at the end |
| `PLC_FILE_READ` | `handle`, `length` | Bytes read, or `0` at EOF for a nonzero request. Use `result.length` bytes from `result.data` |
| `PLC_FILE_WRITE` | `handle`, `length`, `data` | Bytes written. Check the count against `length` |
| `PLC_FILE_SEEK` | `handle`, `offset` | New position from the start of the file, in bytes |
| `PLC_FILE_SYNC` | `handle` | `0` after flushing pending changes while keeping the handle open |
| `PLC_FILE_CLOSE` | `handle` | `0` after closing. Discard the handle after close completes |
| `PLC_FILE_RENAME` | `path`, `destination` | `0` after renaming, replacing an existing destination file atomically |
| `PLC_FILE_REMOVE` | `path` | `0` after deleting the file |

For a larger file, repeat `READ` until EOF or repeat `WRITE` on the same handle
until all chunks have been accepted. Close the handle when done. `result.data`
holds bytes and carries no added string terminator.

### Replacing a recipe atomically

Write the complete JSON to `/web/recipes/recipe-demo.json.tmp`, check the byte
count and wait for a successful close. Then rename the temporary file to
`/web/recipes/recipe-demo.json` with `plc_file_rename()`. Leave the existing
recipe at its final path until the rename. If writing or closing fails, skip
the rename. Use one writer per staging path. A temporary file left after a
failed attempt can be removed or truncated on the next attempt.

Create a C/C++ function block called `RecipeProbe` with one `DINT` output
named `Status`. Paste this into its C/C++ body and call one instance each PLC
scan, for example `RecipeWriter();` in ST after declaring
`RecipeWriter : RecipeProbe;`. This example publishes once per PLC program
start and shares its native state across instances. Watch `RecipeWriter.Status`
for `0` while working, `1` after publishing, or a negative error code.

```cpp
#include "plc_file.h"

enum ERecipeStep { OpenTemporary, WriteTemporary, CloseTemporary, PublishRecipe };
static constexpr char acTemporary[] = "/web/recipes/recipe-demo.json.tmp";
static constexpr char acRecipe[] = "/web/recipes/recipe-demo.json";
static constexpr char acJson[] = "{\"revision\":2,\"source\":\"PLC\"}";
static constexpr uint32_t uiJsonBytes = sizeof(acJson) - 1;
static_assert(uiJsonBytes <= PLC_FILE_BLOCK_SIZE, "Recipe needs chunked writes");

static plc_file_t File;
static ERecipeStep Step;
static int32_t iWriteError;

void setup()
{
    File = {};
    Step = OpenTemporary;
    iWriteError = 0;
    Status = 0;
}

void loop()
{
    if (Status != 0) return;

    switch (Step) {
    case OpenTemporary: {
        const int32_t iStatus = plc_file_open(&File, acTemporary, PLC_OPEN_WRITE);
        if (iStatus == PLC_STORAGE_OK) Step = WriteTemporary;
        else if (iStatus < 0) Status = iStatus;
        break;
    }
    case WriteTemporary: {
        uint32_t uiWritten;
        const int32_t iStatus = plc_file_write(&File, acJson, uiJsonBytes, &uiWritten);
        if (iStatus == PLC_STORAGE_BUSY) return;
        if (iStatus < 0) iWriteError = iStatus;
        else if (uiWritten != uiJsonBytes) iWriteError = PLC_STORAGE_IO;
        Step = CloseTemporary;
        break;
    }
    case CloseTemporary: {
        const int32_t iStatus = plc_file_close(&File);
        if (iStatus == PLC_STORAGE_BUSY) return;
        if (iWriteError) Status = iWriteError;
        else if (iStatus < 0) Status = iStatus;
        else Step = PublishRecipe;
        break;
    }
    case PublishRecipe: {
        const int32_t iStatus = plc_file_rename(&File, acTemporary, acRecipe);
        if (iStatus == PLC_STORAGE_OK) Status = 1;
        else if (iStatus < 0) Status = iStatus;
        break;
    }
    }
}
```

### Reading the recipe over HTTP

After `Status` reaches `1`, send `GET` to
`http://<generator-ip>/recipes/recipe-demo.json` on port 80. The HTTP server
maps `/recipes/recipe-demo.json` to `/web/recipes/recipe-demo.json` in LittleFS.
From an app served by the same generator, use the relative URL
`/recipes/recipe-demo.json`.

```sh
curl -i http://192.168.200.240/recipes/recipe-demo.json
```

The response is `200 OK` with `Content-Type: application/json; charset=utf-8`,
`Cache-Control: no-store` and the body `{"revision":2,"source":"PLC"}`. A
recipe path with no file returns HTTP `404`. If a recipe already exists,
HTTP can read its previous contents while the PLC writes the temporary copy.
A fresh GET after the successful rename returns the replacement.

To reproduce a replacement, first run the example with `revision` set to `1`
and fetch the URL. Then run it again with `revision` set to `2`. After `Status`
reaches `1` again, fetch the same URL and check that the body changed.

The wrapper sequence was verified on a GEN2 test generator at
`http://192.168.200.240/recipes/recipe-wrapper-test.json`. The test block
wrote, read back and deleted a temporary file before publishing the recipe.
The same URL served revision 1 before the rename and revision 2 after it, with
no failed reads during the sampled transition. The debugger reported
`RecipeTestStatus = 2`. The M7 firmware needs the recipe extension from commit
`edac4ef`, and the PLC image needs to be built with the Eurosonic storage runtime.

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
