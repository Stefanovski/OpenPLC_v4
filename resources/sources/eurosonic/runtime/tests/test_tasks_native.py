"""Execute actual MatIEC-generated task dispatch and IEC timers on the host."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT.parents[2]
spec = importlib.util.spec_from_file_location('generate_tasks', ROOT / 'generate_tasks.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
GCC = REPO / '.tooling/msys64/ucrt64/bin/gcc.exe'
IEC = REPO / 'resources/bin/win32/x64/iec2c.exe'


@unittest.skipUnless(GCC.exists() and IEC.exists(), 'Requires bundled MatIEC and local host GCC')
class NativeTaskTests(unittest.TestCase):
    def test_dispatch_instances_timer_isolation_and_host_binding(self):
        with tempfile.TemporaryDirectory(prefix='plc-tasks-native-') as directory:
            root = Path(directory)
            src = root / 'src'
            src.mkdir()
            shutil.copytree(REPO / 'resources/sources/MatIEC/lib', src / 'lib')
            shutil.copy(ROOT / 'runtime/plc_tasks.h', src)
            shutil.copy(ROOT / 'runtime/config.h', src)
            shutil.copy(ROOT / 'src/openplc.h', src)
            shutil.copy(ROOT / 'src/c_blocks.h', src)
            (src / 'program.st').write_text('''PROGRAM MAIN
VAR
    Counter : DINT := 0;
    Timer : TON;
    Done : BOOL;
END_VAR
Counter := Counter + 1;
Timer(IN := TRUE, PT := T#50ms);
Done := Timer.Q;
END_PROGRAM
CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK fast(INTERVAL := T#10ms, PRIORITY := 0);
TASK slow(INTERVAL := T#50ms, PRIORITY := 1);
TASK third(INTERVAL := T#100ms, PRIORITY := 2);
PROGRAM instance0 WITH fast : MAIN;
PROGRAM instance1 WITH slow : MAIN;
PROGRAM instance2 WITH third : MAIN;
END_RESOURCE
END_CONFIGURATION
''')
            subprocess.run([str(IEC), '-f', '-p', '-i', '-l', '-I', str(src / 'lib'), 'program.st'], cwd=src, check=True, capture_output=True)
            (src / 'glueVars.c').write_text('TIME __CURRENT_TIME;')
            module.update_tasks(root)
            resource = src / 'Res0.c'
            resource.write_text(resource.read_text().replace('#include "POUS.c"', ''))
            pous = src / 'POUS.c'
            pous.write_text('#include "POUS.h"\n' + pous.read_text())
            (src / 'test.c').write_text('''#include <assert.h>
#include "iec_std_lib.h"
#include "POUS.h"
#include "plc_tasks.h"
extern const plc_tasks_interface_t plc_tasks_interface;
extern MAIN RES0__INSTANCE0, RES0__INSTANCE1, RES0__INSTANCE2;
extern void config_init__(void);
unsigned long __tick;
BOOL __DEBUG;
static uint32_t current;
static int ready = 1;
int plc_storage_ready(void) { return ready; }
static uint32_t task(void) { return current; }
static void scan(uint32_t index, uint64_t time) { current = index; plc_tasks_interface.run(index, time); }
int main(void) {
    config_init__();
    scan(0, 0); /* Cannot run without matching M7 binding. */
    assert(__GET_VAR(RES0__INSTANCE0.COUNTER) == 0);
    plc_tasks_host_t host = {99, sizeof(host), task};
    assert(plc_tasks_interface.bind(&host) < 0);
    host.version = PLC_TASKS_VERSION;
    assert(plc_tasks_interface.bind(&host) == 0);
    scan(0, 0); scan(1, 0); scan(2, 0);
    for (unsigned t = 10; t <= 50; t += 10) scan(0, t);
    assert(__GET_VAR(RES0__INSTANCE0.COUNTER) == 6);
    assert(__GET_VAR(RES0__INSTANCE1.COUNTER) == 1);
    assert(__GET_VAR(RES0__INSTANCE2.COUNTER) == 1);
    assert(__GET_VAR(RES0__INSTANCE0.DONE));
    assert(!__GET_VAR(RES0__INSTANCE1.DONE));
    scan(1, 50);
    assert(__GET_VAR(RES0__INSTANCE1.DONE));
    scan(2, 100);
    assert(__GET_VAR(RES0__INSTANCE2.DONE));
    current = 0; assert(__CURRENT_TIME.tv_nsec == 50000000);
    current = 2; assert(__CURRENT_TIME.tv_nsec == 100000000);
    current = 1; assert(__CURRENT_TIME.tv_nsec == 50000000);
    ready = 0; scan(0, 60);
    assert(__GET_VAR(RES0__INSTANCE0.COUNTER) == 6);
    ready = 1; plc_tasks_interface.bind(0); scan(0, 70);
    assert(__GET_VAR(RES0__INSTANCE0.COUNTER) == 6);
    return 0;
}
''')
            env = dict(os.environ, PATH=str(GCC.parent) + os.pathsep + os.environ['PATH'])
            result = subprocess.run([str(GCC), '-w', '-O2', '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections', '-I' + str(src / 'lib'), '-I' + str(src), '-I' + str(ROOT / 'runtime'),
                                     'test.c', 'Config0.c', 'Res0.c', 'POUS.c', '-o', 'test.exe'], cwd=src, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr[-6000:])
            subprocess.run([str(src / 'test.exe')], env=env, check=True)


if __name__ == '__main__':
    unittest.main()
