"""Compile and execute the GVL lowering ABI with the bundled MatIEC.
No device access. Actual generated IO glue, debugger catalogue and RETAIN descriptors.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
RUNTIME = REPO / 'resources/sources/eurosonic'
IEC = REPO / 'resources/bin/win32/x64/iec2c.exe'
XML = REPO / 'resources/bin/win32/x64/xml2st.exe'
GCC = REPO / '.tooling/msys64/ucrt64/bin/gcc.exe'

class GvlMatiecTests(unittest.TestCase):
    def test_real_io_debug_force_and_retain_abi(self):
        self.assertTrue(IEC.exists() and GCC.exists(), 'Bundled MatIEC and local host GCC required')
        with tempfile.TemporaryDirectory(prefix='gvl-native-') as folder:
            root = Path(folder)
            src = root / 'src'
            src.mkdir()
            shutil.copytree(REPO / 'resources/sources/MatIEC/lib', src / 'lib')
            shutil.copytree(RUNTIME / 'runtime', root / 'runtime')
            for file in (RUNTIME / 'src').iterdir():
                if file.is_file(): shutil.copy(file, src)
            for name in ['precompile.py', 'generate_storage.py', 'generate_tasks.py']:
                shutil.copy(RUNTIME / name, root)
            def run(args, cwd=src):
                result = subprocess.run([str(a) for a in args], cwd=cwd, env=dict(os.environ, PATH=str(GCC.parent)+os.pathsep+os.environ['PATH']), capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-6000:])
                return result
            run(['node', '-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', REPO / 'scripts/eurosonic/write-gvl-fixture.ts', src], REPO)
            run([XML, '--generate-st', src / 'plc.xml'])
            generated_st = (src / 'program.st').read_text()
            run([IEC, '-f', '-p', '-i', '-l', '-I', src / 'lib', 'program.st'])
            run([XML, '--generate-debug', src / 'program.st', src / 'VARIABLES.csv'])
            run([XML, '--generate-gluevars', src / 'LOCATED_VARIABLES.h'])
            run(['python', 'precompile.py'], root)
            located = (src / 'LOCATED_VARIABLES.h').read_text()
            for address in ['__QX120_6', '__IX100_0', '__IW1000', '__QW1200']:
                self.assertIn(address, located)
            entries = [line.split(';') for line in (src / 'VARIABLES.csv').read_text().splitlines() if ';' in line]
            variables = [entry for entry in entries if entry[1] in ['VAR', 'IN', 'OUT']]
            indices = {entry[2].split('.')[-1]: i for i, entry in enumerate(variables)}
            test = r"""#include <assert.h>
#include <string.h>
#include "iec_std_lib.h"
#include "POUS.h"
#include "plc_storage.h"
extern void config_init__(void), config_run__(unsigned long), glueVars(void);
extern IEC_BOOL *bool_input[256][8], *bool_output[256][8];
extern IEC_UINT *int_input[2048], *int_output[2048];
extern __IEC_UDINT_t CONFIG0__GVL_STATE_COUNT, CONFIG0__GVL_STATE_VOLATILE;
extern void *get_var_addr(size_t);
extern void force_var(size_t, bool, void *);
extern int32_t plc_storage_variable(uint32_t, plc_retain_variable_t *);
unsigned long __tick;
int main(void) {
 glueVars(); config_init__();
 assert(bool_output[120][6] && bool_input[100][0] && int_input[1000] && int_output[1200]);
 *bool_input[100][0] = 1; *int_input[1000] = 123;
 config_run__(0);
 assert(*bool_output[120][6] == 1 && *int_output[1200] == 124);
 assert(CONFIG0__GVL_STATE_COUNT.value == 43 && CONFIG0__GVL_STATE_VOLATILE.value == 8);
 assert(*(BOOL*)get_var_addr(LAMP_INDEX) == 1);
 assert(*(UDINT*)get_var_addr(COUNT_INDEX) == 43);
 BOOL off = 0; force_var(LAMP_INDEX, true, &off); config_run__(1);
 assert(*bool_output[120][6] == 0);
 force_var(LAMP_INDEX, false, 0); config_run__(2); assert(*bool_output[120][6] == 1);
 UDINT forced = 100; force_var(COUNT_INDEX, true, &forced); config_run__(3);
 assert(CONFIG0__GVL_STATE_COUNT.value == 100);
 force_var(COUNT_INDEX, false, 0); config_run__(4); assert(CONFIG0__GVL_STATE_COUNT.value == 101);
 plc_retain_variable_t item; void *retained = 0; uint32_t saved = 0; unsigned retainedCount = 0;
 for(unsigned i=0; plc_storage_variable(i, &item)>0; ++i) if(item.size) {
  assert(item.size == 4); assert(strstr(item.name, "GVL_STATE_COUNT"));
  retainedCount++; retained = item.data; memcpy(&saved, item.data, 4);
 }
 assert(retainedCount == 1 && saved == 101 && retained == &CONFIG0__GVL_STATE_COUNT.value);
 config_init__(); assert(CONFIG0__GVL_STATE_COUNT.value == 42 && CONFIG0__GVL_STATE_VOLATILE.value == 7);
 memcpy(retained, &saved, 4); config_run__(0);
 assert(CONFIG0__GVL_STATE_COUNT.value == 102 && CONFIG0__GVL_STATE_VOLATILE.value == 8);
 return 0;
}
"""
            test = test.replace('LAMP_INDEX', str(indices['GVL_IO_LAMP'])).replace('COUNT_INDEX', str(indices['GVL_STATE_COUNT']))
            (src / 'test.c').write_text(test)
            run([GCC, '-w', '-O2', '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections', '-I'+str(src/'lib'), '-I'+str(src), '-I'+str(root/'runtime'), 'test.c', 'Config0.c', 'Res0.c', 'POUS.c', 'debug.c', 'glueVars.c', '-o', 'test.exe'])
            run([src / 'test.exe'])
            # Instrumented build must retain statement identities and the same variable catalogue.
            before = (src / 'VARIABLES.csv').read_bytes()
            (src / 'program.st').write_text(generated_st)
            run([IEC, '-f', '-p', '-i', '-l', '-g', '-I', src / 'lib', 'program.st'])
            self.assertEqual((src / 'VARIABLES.csv').read_bytes(), before)
            metadata = json.loads((src / 'program.debug.json').read_text())
            self.assertGreater(len(metadata['statements']), 0)


if __name__ == '__main__':
    unittest.main()
