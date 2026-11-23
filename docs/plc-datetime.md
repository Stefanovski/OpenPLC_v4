# M7 UTC clock from ST and C/C++

The Eurosonic library provides `ES_GET_DATETIME` and `ES_SET_DATETIME` as
functions. They access the M7 RTC synchronously, only when called. There is no
background poll, new task, automatic synchronization, save or PLC download.

The clock is **UTC with one-second resolution**. This board uses HSE/25 and
does not keep time without VDD or in Stop/Standby. Each M7 application start
invalidates the clock until it is explicitly set (PLC or the existing Telnet
`rtcset` command). A retained old calendar is not reported as current time.

## ST

Declare `DateTime` as `DT` (`DATE_AND_TIME`), `ClockValid` as `BOOL`, and
`ReadStatus` / `SetStatus` as `DINT` in the variable table. A simple read is:

```iecst
DateTime := ES_GET_DATETIME();
```

Use the optional outputs to detect an unset clock, missing firmware support or
a concurrent write. A failed read returns `DT#1970-01-01-00:00:00`, **not a
last-known valid time**:

```iecst
Candidate := ES_GET_DATETIME(VALID => ClockValid, STATUS => ReadStatus);
IF ClockValid THEN
    DateTime := Candidate;
END_IF;
```

`Candidate` also has type `DT`. `STATUS` belongs to this particular call;
there is no shared last-error variable between the three PLC tasks.

Set on an explicit event. Declare `SetClock` as `BOOL`, `SetEdge` as `R_TRIG`
and `RequestedUtc` as `DT`, for example initialized to
`DT#2026-11-23-12:00:00`:

```iecst
SetEdge(CLK := SetClock);
IF SetEdge.Q THEN
    SetStatus := ES_SET_DATETIME(RequestedUtc);
END_IF;
```

This sets the **system-wide** M7 RTC. Do not call SET unconditionally every
scan: that would repeatedly reset the clock. A busy result means no write was
started; the PLC program can retry on another explicit event. An RTC error
during a write can leave the clock marked unset; a successful SET is then
required. No retry is scheduled by the library.

## C++ function blocks

Place the include before `setup()` / `loop()`. Declare `DateTime : DT`,
`ClockValid : BOOL` and `ReadStatus : DINT` as block outputs in the editor:

```cpp
#include "lib/es_datetime.h"

void setup() {}
void loop()
{
    DateTime = ES_GET_DATETIME(true, nullptr, &ClockValid, &ReadStatus);
}
```

C++ also supports `auto now = ES_GET_DATETIME();` and
`auto status = ES_SET_DATETIME(requestedUtc);`, where `requestedUtc` is an
`IEC_DT` / the editor's `DT` variable. A `DT` has `tv_sec` (Unix UTC seconds)
and `tv_nsec` (zero for RTC values). Do not use C++ `std::chrono` or `time_t`
as an assumed ABI-compatible substitute.

C uses the MatIEC-compatible signatures from the same header:

```c
IEC_BOOL valid;
IEC_DINT status;
IEC_DT now = ES_GET_DATETIME(1, NULL, &valid, &status);
/* On an explicit request only: */
status = ES_SET_DATETIME(1, NULL, requestedUtc);
```

Native C/C++ can alternatively include `plc_clock.h` and call
`plc_get_datetime(int32_t *utc_seconds)` or `plc_set_datetime(int32_t utc_seconds)`.
Both return a status. The native getter preserves its output on failure.

## Status and representation

| Value | Meaning |
| --- | --- |
| `0` | Success (`VALID=TRUE` for GET) |
| `1` | RTC is busy; no waiting for another caller |
| `-1100` | No compatible M7 clock host, RTC unavailable, or invalid execution context |
| `-1101` | Clock has not been explicitly set after boot |
| `-1102` | Outside supported range or nonzero nanoseconds on SET |
| `-1103` | RTC read/write/synchronization error |
| `-1104` | Invalid native C argument (null output pointer) |
| `-1105` | EN is false; no access performed |

`DT` keeps its existing **signed 32-bit seconds / signed 32-bit nanoseconds**
layout. The common supported interval is **2000-01-01 00:00:00 through
2038-01-19 03:14:07 UTC**. The M7 calendar supports later years, but GET reports
`-1102` for them instead of wrapping. Do not construct out-of-range IEC
literals or cast larger epoch values to 32 bits; validate before conversion.
Extending IEC DT beyond 2038 would require a separate compiler/debugger/ABI
change and is deliberately outside this feature.

Neither GET nor SET changes `__CURRENT_TIME`, `TON`, `TOF`, scan counters or
FreeRTOS task scheduling. Calendar time advances while statement debugging is
paused; IEC timer behavior remains as before. SET has a total **2 ms hardware
wait budget**, plus a finite iteration fallback if the tick fails. Interrupts
and scheduling remain enabled; this is not a guaranteed end-to-end execution
time under preemption. GET does not wait for hardware synchronization.

## Compatibility and validation

The new optional clock ABI v1 is at `0x081C0A00`. Existing init/run, debugger,
storage/RETAIN and task ABI addresses and layouts are unchanged. Matching M7
binds after PLC initialization and unbinds after every PLC task stops. Older
PLCs are ignored by this optional host; older M7 firmware leaves new clock
calls unavailable. Existing task/storage compatibility requirements still
apply. The shared `plc_clock.h` must match the M7 copy byte for byte.

`DT` literals exposed a pre-existing bare-metal link problem: MatIEC's error
notification used `stderr`, pulling OS syscalls into PLC images. Only the
Eurosonic CMake target now routes that notification to the nonblocking atomic
counter `plc_iec_runtime_error_count()`. It preserves the existing return/
continuation behavior and resets at PLC initialization. Other targets retain
their existing notification.

Host tests:

```powershell
py resources/sources/eurosonic/runtime/tests/test_clock_native.py
py -m unittest discover -s resources/sources/eurosonic/runtime/tests -p 'test_*.py'
node node_modules/jest/bin/jest.js --runInBand --no-coverage --roots src --runTestsByPath src/utils/cpp/eurosonic.test.ts
```

ARM ST fixtures (MatIEC, glue/debug catalogue, RETAIN generation, linker):

```powershell
$fixture = "$PWD/resources/sources/eurosonic/runtime/tests/clock_fixture.st"
& resources/sources/eurosonic/runtime/tests/build_storage_fixture.ps1 -Fixture $fixture
& resources/sources/eurosonic/runtime/tests/build_storage_fixture.ps1 -Fixture $fixture -TaskCount 3 -StatementDebug
```

These compile artifacts only. Hardware acceptance still requires a separate
firmware/PLC installation: verify NOT_SET after cold start, explicit SET then
immediate GET, subsequent one-second increments, an unchanged blinking output,
and task timing during a SET. Restore the customer's PLC image afterwards.

### Implementation validation (2026-11-23)

- M7 Debug firmware and OpenPLC production editor build: passed.
- Actual MatIEC ST and generated C++ native execution: passed.
- Complete ARM links: ST single task, ST three tasks with statement debugging,
  native C++ blocks, and the existing three-task storage fixture: passed.
- Runtime Python suite: 11 tests passed. M7 RTC register simulation, all 36525
  calendar dates, existing Telnet and storage/RETAIN regressions: passed.
- Editor Jest suite: 628 passed; four `compiler-module.spec.ts` tests fail
  because plain Node has no Electron `app.getPath`. The same four failures
  were reproduced in the original working directory without these changes.
- TypeScript source check with `--skipLibCheck`, focused ESLint: passed.
  Without `--skipLibCheck`, installed third-party declaration incompatibilities
  remain (Node/TypeScript iterator declarations); no source errors were found.
- The OpenPLC/M7 clock ABI header hashes match.

### Generator acceptance (2026-11-23)

Matching M7 Debug firmware was installed and verified through ST-Link. A
temporary MatIEC-built PLC exercised ST and generated C++ on the generator:

- NOT_SET after application restart; explicit ST SET and GET in the same scan.
- 2000-02-28 midnight rollover to leap day; C++ SET/GET agrees with ST.
- Dates before 2000 and fractional SET values rejected without changing UTC.
- Last representable DT second accepted; subsequent 2038 overflow reports RANGE.
- Final RTC value synchronized to the test PC's current UTC.
- Three tasks measured over 3.21 s: 100.00 / 19.94 / 9.97 cycles per second
  for 10 / 50 / 100 ms tasks. The 500 ms blink timer continued across SETs.
  This is a functional timing sample, not a worst-case jitter qualification.

The test exposed and fixed an M7 validity check: hardware INITS is clear for
year 00 (2000), so the explicitly committed BKP29 marker determines whether
UTC was set. A register-level regression now covers this case.

The complete original PLC flash was restored byte for byte, including the
persistent upload image. Original project files were unchanged. RUN, RETAIN
value 40, storage statuses, module inventory and changing digital outputs were
verified afterwards. Bootloader and M4 were unchanged; the new M7 remains.
Backups, test scripts and machine-readable results are in the local Codex
artifact directory `plc-datetime-validation-20261123` (`verification.json`).

Test automation must wait for PLC loading to finish after `/api/plcstart`:
the HTTP acknowledgement precedes completion of flash programming and PLC
initialization. Accessing the legacy debug function table immediately caused
a timeout/reset in the first attempt. The final run used a 5-second start
wait. No production debugger/download behavior was changed in this task.
