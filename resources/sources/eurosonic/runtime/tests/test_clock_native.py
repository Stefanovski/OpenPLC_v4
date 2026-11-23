"""Run MatIEC ST and native C/C++ clock calls against a simulated M7 host."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[2]
GCC = REPO / '.tooling/msys64/ucrt64/bin/gcc.exe'
GPP = GCC.with_name('g++.exe')
IEC = REPO / 'resources/bin/win32/x64/iec2c.exe'


@unittest.skipUnless(GCC.exists() and IEC.exists(), 'Requires MatIEC and host GCC')
class ClockTests(unittest.TestCase):
    def test_st_cpp_status_binding_and_timer_independence(self):
        with tempfile.TemporaryDirectory(prefix='plc-clock-native-') as directory:
            root = Path(directory)
            shutil.copytree(REPO / 'resources/sources/MatIEC/lib', root / 'lib')
            shutil.copy(ROOT / 'src/c_blocks.h', root)
            shutil.copy(ROOT / 'src/openplc.h', root)
            (root / 'program.st').write_text('''PROGRAM MAIN
VAR
    UtcNow : DT;
    Valid : BOOL;
    ReadStatus : DINT;
    SetStatus : DINT;
    SetClock : BOOL;
    Timer : TON;
END_VAR
IF SetClock THEN SetStatus := ES_SET_DATETIME(DT#2026-11-23-12:00:00); END_IF;
UtcNow := ES_GET_DATETIME(VALID => Valid, STATUS => ReadStatus);
Timer(IN := TRUE, PT := T#500ms);
END_PROGRAM
CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#10ms, PRIORITY := 1);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION
''')
            env = dict(os.environ, PATH=str(GCC.parent) + os.pathsep + os.environ['PATH'])
            def run(exe, *args):
                result = subprocess.run([str(exe), *map(str, args)], cwd=root, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr[-8000:])
            run(IEC, '-f', '-p', '-i', '-l', '-I', root / 'lib', 'program.st')
            (root / 'test.c').write_text(r'''
#include <assert.h>
#include "POUS.h"
#include "POUS.c"
#include "plc_diagnostics.h"
extern const plc_clock_interface_t plc_clock_interface;
extern void check_cpp(void);
TIME __CURRENT_TIME;
BOOL __DEBUG;
static int32_t status, seconds = 1795435200;
static unsigned reads, writes;
static int32_t get(int32_t *result) { ++reads; *result = seconds; return status; }
static int32_t set(int32_t value) { ++writes; if (!status) seconds = value; return status; }
int main(void) {
    MAIN p = {0}; MAIN_init__(&p, 0);
    MAIN_body__(&p);
    assert(!p.VALID.value && p.READSTATUS.value == PLC_CLOCK_UNAVAILABLE);
    assert(p.UTCNOW.value.tv_sec == 0 && reads == 0 && writes == 0);
    plc_clock_host_t host = {99, sizeof(host), get, set};
    plc_clock_interface.bind(&host); MAIN_body__(&p);
    assert(p.READSTATUS.value == PLC_CLOCK_UNAVAILABLE);
    host.version = PLC_CLOCK_VERSION; host.size = 0;
    plc_clock_interface.bind(&host); assert(plc_set_datetime(seconds) == PLC_CLOCK_UNAVAILABLE);
    host.size = sizeof(host); host.get = 0;
    plc_clock_interface.bind(&host); assert(plc_set_datetime(seconds) == PLC_CLOCK_UNAVAILABLE);
    host.get = get; plc_clock_interface.bind(&host);
    status = PLC_CLOCK_NOT_SET; MAIN_body__(&p);
    assert(!p.VALID.value && p.READSTATUS.value == PLC_CLOCK_NOT_SET);
    status = 0; MAIN_body__(&p);
    assert(p.VALID.value && p.UTCNOW.value.tv_sec == seconds && p.UTCNOW.value.tv_nsec == 0);
    status = PLC_CLOCK_BUSY; MAIN_body__(&p);
    assert(!p.VALID.value && p.READSTATUS.value == 1 && p.UTCNOW.value.tv_sec == 0);
    int32_t preserved = 42;
    assert(plc_get_datetime(&preserved) == PLC_CLOCK_BUSY && preserved == 42);
    status = 0; seconds = INT32_MAX; MAIN_body__(&p);
    assert(p.VALID.value && p.UTCNOW.value.tv_sec == INT32_MAX);
    seconds = -1; MAIN_body__(&p);
    assert(!p.VALID.value && p.READSTATUS.value == PLC_CLOCK_RANGE);
    seconds = PLC_CLOCK_MIN_SECONDS;
    p.SETCLOCK.value = 1; MAIN_body__(&p); p.SETCLOCK.value = 0;
    assert(p.SETSTATUS.value == 0 && writes == 1 && seconds == 1795435200);
    assert(__CURRENT_TIME.tv_sec == 0 && __CURRENT_TIME.tv_nsec == 0);
    __CURRENT_TIME.tv_nsec = 500000000; MAIN_body__(&p);
    assert(p.TIMER.Q.value && writes == 1);
    BOOL valid = 1, eno = 1; DINT result = 0;
    const unsigned before = reads;
    assert(ES_GET_DATETIME(0, &eno, &valid, &result).tv_sec == 0);
    assert(!eno && !valid && result == PLC_CLOCK_DISABLED && reads == before);
    assert(ES_SET_DATETIME(0, &eno, (DT){seconds,0}) == PLC_CLOCK_DISABLED && writes == 1);
    assert(ES_SET_DATETIME(1, &eno, (DT){seconds,1}) == PLC_CLOCK_RANGE && !eno);
    assert(plc_set_datetime(0) == PLC_CLOCK_RANGE && writes == 1);
    assert(plc_get_datetime(0) == PLC_CLOCK_ARGUMENT);
    status = PLC_CLOCK_IO;
    assert(ES_SET_DATETIME(1, &eno, (DT){seconds,0}) == PLC_CLOCK_IO && !eno);
    status = 0; check_cpp();
    plc_clock_interface.bind(0); MAIN_body__(&p);
    assert(p.READSTATUS.value == PLC_CLOCK_UNAVAILABLE && !p.VALID.value);
    assert(plc_iec_runtime_error_count() == 0);
    __iec_error(); assert(plc_iec_runtime_error_count() == 1);
    return 0;
}
''')
            (root / 'test.cpp').write_text('''#include <cassert>
#include "es_datetime.h"
extern "C" void check_cpp() {
    IEC_BOOL valid = 0; IEC_DINT status = -1;
    auto utc = ES_GET_DATETIME(true, nullptr, &valid, &status);
    assert(valid && status == 0 && utc.tv_sec == 1795435200);
    assert(ES_GET_DATETIME().tv_sec == utc.tv_sec);
    assert(ES_SET_DATETIME(utc) == 0);
    assert(ES_SET_DATETIME(true, nullptr, utc) == 0);
}
''')
            flags = ['-DEUROSONIC_PLC=1', '-Ilib', '-I.', '-I' + str(ROOT / 'runtime')]
            run(GCC, *flags, '-std=gnu11', '-O2', '-w', '-ffunction-sections', '-fdata-sections', '-c', 'test.c', ROOT / 'runtime/plc_clock.c', ROOT / 'runtime/plc_diagnostics.c')
            run(GPP, *flags, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-c', 'test.cpp', '-o', 'cpp.o')
            run(GPP, '-Wl,--gc-sections', 'test.o', 'cpp.o', 'plc_clock.o', 'plc_diagnostics.o', '-o', 'test.exe')
            run(root / 'test.exe')


if __name__ == '__main__':
    unittest.main()
