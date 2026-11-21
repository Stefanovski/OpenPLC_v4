# Eurosonic PLC tasks (maximum three)

The Eurosonic target supports one unchanged legacy PLC scan, or two/three cyclic
FreeRTOS tasks configured through Resource → Tasks and Instances. Both repositories
use the branch `codex/plc-three-tasks`; the matching M7 firmware is required before
installing a multiple-task PLC image. Other targets are unchanged.

## Configuration

Example (task names must differ from POU/type names):

| Task | Interval | IEC priority | Example program |
| --- | --- | --- | --- |
| task_fast | T#10ms | 0 | FastLogic |
| task_slow | T#50ms | 1 | Monitoring |
| task_background | T#100ms | 2 | BackgroundLogic |

Assign each program instance to exactly one task. Separate instances of the same
ST, graphical or C++ program remain separate objects. Task bodies preserve the
generated order of programs assigned to that task. A task that was not configured
is not created and does not wake up. With two tasks there is one auxiliary thread;
with three there are two. The M7 reserves two static 4 KiB stacks and TCBs even when
they are not used. Task 0 runs on the existing `openplc` thread.

For multiple tasks, supported intervals are constant whole milliseconds from 1 ms
to 24 hours, priorities 0..31 (smaller means higher), one Res0 resource and names
up to 31 characters. Interrupt/event tasks are rejected in multiple-task mode.
The compiler enforces the limit, including projects edited as text or externally.
Single-task projects keep their existing scheduler and time semantics.

## Timing and data ownership

Normal builds use preemptive scheduling with absolute release times. A 10 ms
interval does not become 10 ms plus execution time. Missed releases are counted
and skipped instead of executing an unbounded burst of overdue scans. Lower IEC
priority numbers map to higher FreeRTOS priorities, equal numbers remain equal.
The M7 maps the at most three ranks to `osPriorityAboveNormal1` through
`osPriorityAboveNormal3`, below its system manager and Ethernet RX. This applies
only to explicit multiple-task projects; legacy priority remains unchanged.

Execution time must fit the available CPU budget. Higher-priority tasks, interrupt
handlers and the short IO transfers can delay another task. A configured interval
is not an unconditional real-time guarantee. Use a normal build for timing tests;
the M7 counters `aPlcTaskStatistics[0..2]` expose completed scans, missed releases,
maximum start lateness and maximum scan duration in milliseconds through ST-Link.
Sub-millisecond jitter is not measured by these counters.
The counters describe multiple-task mode; they are cleared on entering the
legacy single-task path, whose existing scan counter remains unchanged.

Each task has its own stable IEC time value for its current scan, selected by the
host's current FreeRTOS task. TON/TOF/TP and ST/C++ instances no longer share a
mutable scan-time value between preempted tasks. All clocks share a monotonic
project epoch; 32-bit RTOS tick wrap is extended by the host.

Global variables and the IO image are shared, not isolated task memory. Use one
writer per output/global state and separate FB instances between tasks. Inputs
can be refreshed by another task; copy values into task-local variables when a
calculation needs a stable snapshot. Cross-task structures, arrays, 64-bit values
and read/modify/write operations need an explicit communication/synchronization
design. Arbitrary shared C++ statics and raw hardware access are not made thread
safe by this feature. IO publication is a shared-image transfer, not an atomic
transaction covering all assignments of an individual program.

Only the bounded input/output transfers exclude task switching. User program code
is preemptible. RETAIN capture occurs only when all in-flight scans are complete;
a preempted multi-word assignment must not be captured. On STOP all workers finish
before the storage ABI is unbound or PLC flash can be replaced. Existing file API
capacity/BUSY semantics remain unchanged; use separate file-block instances.

## Statement debugger

Statement-debug builds intentionally serialize scans using a separate execution
mutex. At a breakpoint the existing data mutex is released for debugger reads,
but the execution mutex remains held: other PLC scans cannot change the halted
state or call stack. Ethernet and debugger communication continue. Continue and
step retain the existing protocol. Time spent waiting at a breakpoint is excluded
from the PLC clock, and release schedules are restarted after a halt.

This mode preserves consistent debugging, not production timing. It is announced
in the Resource editor, build output and M7 console. This is a deliberate first
version boundary: independently halting/stepping preemptive PLC threads is not
implemented.

## ABI and compatibility

The optional `plc_tasks_interface_t` v1 table is located at `0x081C0900`, after the
unchanged entry points, debug ABI and storage ABI. The matching header is copied
byte-for-byte into M7. Firmware validates version, size, count, intervals, names,
priorities and Thumb code pointers. Unsupported/malformed task tables are rejected.
An absent table keeps the legacy path. The PLC's serial `run_plc` refuses to run
multiple-task images; an old host must never silently run their programs serially.
This is not a substitute for installing matching firmware: old firmware cannot
report the new capability or provide the new task lifecycle.

`generate_tasks.py` transforms only the generated build copy. It extracts MatIEC
task bodies, rejects unrecognized scheduler code, emits separate dispatch entries
and replaces the build copy's IEC time declaration. The source PLC project and
the shared MatIEC installation are not modified. Existing compiler, Codex/MCP,
download and project-edit approval flows are unchanged.

## Validation (2026-11-21)

- All 70 editor suites / 584 tests pass; production main/renderer builds pass.
- Source TypeScript checking passes with `--skipLibCheck`; full library checking
  reports existing Node Buffer/iterator declaration incompatibilities in dependencies.
- Generator validation and native execution tests pass: limits, assignment errors,
  comments/pragmas, durations, unchanged single-task selection, idempotent generation,
  fail-closed unknown output, host binding, independent instances and actual TONs.
- ARM builds: one, two and three tasks, normal and statement-debug variants.
- M7 Debug build and native schedule tests: priority mapping, 10,000 releases with
  no execution-time drift, missed-cycle accounting and tick wrap.
- Existing storage tests pass (1,513 interrupted writes, 1,504 corrupted bytes,
  81 recipe cut points, real LittleFS operations and all existing guards).
- On the STM32H747 target at 480 MHz: task periods 10/50/100 ms, with the 50 ms
  program deliberately busy for 20 ms. The 10 ms task preempted it twice. After
  raising the bounded multiple-task priority, a sample covering 3,585 fast scans
  and HTTP/TFTP traffic had zero missed fast/medium releases and zero start
  lateness at 1 ms resolution. Lowest-priority task start lateness was 20 ms.
- Deliberate 60 ms work in a 50 ms task: 43 completed slow scans / 43 missed slow
  releases; the fast task completed 429 scans without misses. Overdue work did not
  produce catch-up bursts.
- Target thread counts: 18 with the original/one-task project, 19 with two tasks,
  20 with three (same system workload). Returning to one task removed both workers.
- Actual Modbus statement debugger: halt, stable halted state, step, call stack,
  continue, and STOP while the auxiliary SLOW task was halted; subsequent legacy
  program startup and TON execution succeeded.
- After acceptance the original PLC image was restored. Flash readback confirmed
  its payload byte-for-byte and unchanged bootloader/M4 regions. The new M7
  development firmware remains installed; the original full flash image was
  backed up locally before testing. No bench fixture remains installed.

The bench fixture `resources/sources/eurosonic/runtime/tests/tasks_timing_fixture.st`
has no outputs and no RETAIN and assumes a 480 MHz M7 for its deliberate busy loop.
It is a timing test, not application code. These measurements are bounded bench
evidence, not a worst-case timing certification or an endurance qualification.

## Reproduce and accept

1. Build/install the matching M7 branch through the normal firmware workflow.
2. Open a copy of the PLC project, leave its one-task configuration unchanged,
   compile normally and check the existing IO/ST/C++ behavior first.
3. Add a second task at 50 ms and assign a separate counter program. Keep the
   first task at 10 ms and give it the higher priority. Counters should advance
   approximately 100/s and 20/s. Add a third at 100 ms to check approximately 10/s.
4. Inspect the M7 statistics over representative runtime and network/storage load.
   Require zero missed releases for deadline-sensitive tasks; examine maximum
   lateness/duration, not just average counter rates.
5. Check the actual application IO ownership and shared-data handoffs. Test the
   intended C++ workload and its stack usage, not only the supplied counter example.
6. Compile for statement debugging and test breakpoint/step/continue, then STOP
   and restart. Recompile normally before accepting timing.
7. Remove the extra tasks and their instance assignments. Verify the old behavior
   and absence of auxiliary task handles again. Existing tasks are never created
   merely because the firmware reserves capacity for them.

Local commands from the OpenPLC root:

```powershell
py -m unittest discover -s resources/sources/eurosonic/runtime/tests -p 'test_*.py'
./resources/sources/eurosonic/runtime/tests/build_storage_fixture.ps1 -TaskCount 3
./resources/sources/eurosonic/runtime/tests/build_storage_fixture.ps1 -TaskCount 2 -StatementDebug
```

Do not deploy the storage fixture to a controller whose RETAIN checkpoints must
be preserved; use the separate non-RETAIN timing fixture for that bench test.
