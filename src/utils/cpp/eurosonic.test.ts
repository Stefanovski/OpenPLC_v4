import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { writeEurosonicCppFiles } from '@root/main/modules/compiler/eurosonic-cpp'
import type { PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'
import { XmlGenerator } from '@root/utils/PLC/xml-generator'

import { generateEurosonicCppSource, generateEurosonicCppST, validateEurosonicCpp } from './eurosonic'
import type { CppPouData } from './generateCBlocksCode'

const scalar = (name: string, cls: PLCVariable['class'] = 'input', value = 'int'): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value } as PLCVariable['type'],
  location: '',
  documentation: '',
})
const array = (name: string, cls: PLCVariable['class'], ranges: string[]): PLCVariable => ({
  ...scalar(name, cls),
  type: {
    definition: 'array',
    value: `ARRAY [${ranges.join(',')}] OF INT`,
    data: {
      baseType: { definition: 'base-type', value: 'int' },
      dimensions: ranges.map((dimension) => ({ dimension })),
    },
  },
})
const variables = [
  scalar('Input'),
  scalar('Output', 'output'),
  scalar('Counter', 'local'),
  scalar('Shared', 'inOut'),
  scalar('Scratch', 'temp'),
  scalar('External', 'external'),
  array('Samples', 'input', ['-1..1', '2..3']),
  array('Results', 'output', ['1..2']),
  scalar('Duration', 'local', 'time'),
  scalar('Label', 'local', 'string'),
  scalar('UtcNow', 'output', 'dt'),
  scalar('ClockValid', 'output', 'bool'),
  scalar('ClockStatus', 'output', 'dint'),
]
const block: CppPouData = {
  name: 'NativeBlock',
  variables,
  code: `
#include "lib/es_datetime.h"
static int helper(int value) { return value; }
void setup() { Counter = 10; }
void loop() {
  ++Counter; ++Shared; ++External; ++Scratch;
  Output = helper(Input) + Counter + Scratch;
  Results[1] = Samples[-1][2]; Results[2] = Samples[1][3];
  Duration.tv_sec = Counter; Label.len = 1; Label.body[0] = 'X';
  UtcNow = ES_GET_DATETIME(true, nullptr, &ClockValid, &ClockStatus);
  if (Input == 1234) ClockStatus = ES_SET_DATETIME(UtcNow);
}`,
}

const otherBlock: CppPouData = {
  name: 'OtherBlock',
  variables: [scalar('Input'), scalar('Output', 'output')],
  code: '#include <stdint.h>\nstatic int helper(int value) { return value * 2; }\nvoid setup() { Output = 0; }\nvoid loop() { Output = helper(Input); }',
}
const blocks = [block, otherBlock]

describe('Eurosonic C++ integration', () => {
  it('requires real entry definitions and includes native-only edits in program identity', () => {
    expect(validateEurosonicCpp({ ...block, code: '// void setup() {}\nvoid loop() {}' }).valid).toBe(false)
    expect(validateEurosonicCpp({ ...block, code: 'void setup(void) {}\nvoid loop(void) {}' }).valid).toBe(true)
    const code = '#include <stdint.h>\n// void setup() {}\nvoid setup() {}\nvoid loop() {}'
    const generated = generateEurosonicCppSource([{ ...block, code }])
    expect(generated.indexOf('#include <stdint.h>')).toBeLessThan(generated.indexOf('#define Input'))
    expect(generated).toContain('// void setup() {}')
    expect(generateEurosonicCppST(block.name, variables, block.code)).not.toBe(
      generateEurosonicCppST(block.name, variables, block.code + '\n// native edit'),
    )
  })
  it('validates unsupported classes, reserved names and invalid arrays before building', () => {
    expect(validateEurosonicCpp(block).valid).toBe(true)
    expect(validateEurosonicCpp(block, 'function').valid).toBe(false)
    for (const invalid of [scalar('hasBeenInitialized'), scalar('x', 'global'), array('x', 'input', ['3..1'])]) {
      expect(validateEurosonicCpp({ ...block, variables: [invalid] }).valid).toBe(false)
    }
  })

  const repo = resolve('.')
  const matiec = join(repo, 'resources/bin/win32/x64/iec2c.exe')
  const gcc = join(repo, '.tooling/msys64/ucrt64/bin/gcc.exe')
  const gpp = join(repo, '.tooling/msys64/ucrt64/bin/g++.exe')
  const nativeTest = existsSync(matiec) && existsSync(gcc) && existsSync(gpp) ? it : it.skip
  nativeTest(
    'runs generated MatIEC/C++ code: independent instances, setup, temp, arrays, external and forcing',
    async () => {
      mkdirSync(join(repo, '.tooling'), { recursive: true })
      const root = await mkdtemp(join(repo, '.tooling/cpp-integration-'))
      const src = join(root, 'src')
      mkdirSync(src)
      cpSync(join(repo, 'resources/sources/eurosonic'), root, { recursive: true })
      cpSync(join(repo, 'resources/sources/MatIEC/lib'), join(src, 'lib'), { recursive: true })
      const wrapper = generateEurosonicCppST(block.name, variables, block.code)
      const otherWrapper = generateEurosonicCppST(otherBlock.name, otherBlock.variables, otherBlock.code)
      const project: PLCProjectData = {
        dataTypes: [],
        pous: [
          {
            type: 'function-block',
            data: {
              name: block.name,
              language: 'st',
              documentation: '',
              variables: [...variables, scalar('hasBeenInitialized', 'local', 'bool')],
              body: { language: 'st', value: wrapper },
            },
          },
          {
            type: 'function-block',
            data: {
              name: otherBlock.name,
              language: 'st',
              documentation: '',
              variables: [...otherBlock.variables, scalar('hasBeenInitialized', 'local', 'bool')],
              body: { language: 'st', value: otherWrapper },
            },
          },
          {
            type: 'program',
            data: {
              name: 'main',
              language: 'st',
              documentation: '',
              variables: [
                { ...scalar('Other', 'local'), type: { definition: 'derived', value: otherBlock.name } },
                { ...scalar('First', 'local'), type: { definition: 'derived', value: block.name } },
                scalar('Value', 'local'),
              ],
              body: { language: 'st', value: 'First(Input := 1, Shared := Value); Other(Input := 3);' },
            },
          },
        ],
        configuration: {
          resource: {
            globalVariables: [scalar('External', 'global')],
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
          },
        },
      }
      const xml = XmlGenerator(project)
      expect(xml.ok).toBe(true)
      writeFileSync(join(src, 'plc.xml'), xml.data!)
      const st = `FUNCTION_BLOCK NativeBlock
VAR_INPUT Input : INT; Samples : ARRAY[-1..1,2..3] OF INT; END_VAR
VAR_OUTPUT Output : INT; Results : ARRAY[1..2] OF INT; UtcNow : DT; ClockValid : BOOL; ClockStatus : DINT; END_VAR
VAR_IN_OUT Shared : INT; END_VAR
VAR Counter : INT; hasBeenInitialized : BOOL; Duration : TIME; Label : STRING; END_VAR
VAR_TEMP Scratch : INT; END_VAR
VAR_EXTERNAL External : INT; END_VAR
${wrapper}
END_FUNCTION_BLOCK
FUNCTION_BLOCK OtherBlock
VAR_INPUT Input : INT; END_VAR
VAR_OUTPUT Output : INT; END_VAR
VAR hasBeenInitialized : BOOL; END_VAR
${otherWrapper}
END_FUNCTION_BLOCK
PROGRAM MAIN
VAR First : NativeBlock; Second : NativeBlock; Value : INT; END_VAR
First(Input := 1, Shared := Value); Second(Input := 2, Shared := Value);
END_PROGRAM
CONFIGURATION Config0
VAR_GLOBAL External : INT; END_VAR
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION`
      writeFileSync(join(src, 'program.st'), st)
      const run = (exe: string, args: string[]) =>
        execFileSync(exe, args, {
          cwd: src,
          timeout: 60000,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${resolve(gcc, '..')};${process.env.PATH}` },
          stdio: 'inherit',
        })
      run(matiec, ['-f', '-p', '-i', '-l', '-I', join(src, 'lib'), 'program.st'])
      await writeEurosonicCppFiles(src, blocks)
      // Keep an exact copy of compiler output for the ARM test. The native harness
      // replaces only the C runtime header with the minimal literal it uses.
      cpSync(join(src, 'POUS.h'), join(src, 'POUS.arm.h'))
      const header = readFileSync(join(src, 'POUS.h'), 'utf8').replace(
        '#include "iec_std_lib.h"',
        '#include "iec_types_all.h"\n#include "c_blocks.h"\n#define __BOOL_LITERAL(x) x\n#define __STRING_LITERAL(n,s) ((STRING){n,s})\n#define __time_to_timespec(...) ((TIME){0,0})\n#define __dt_to_timespec(...) ((DT){0,0})',
      )
      writeFileSync(join(src, 'POUS.h'), header)
      writeFileSync(
        join(root, 'host.c'),
        `#include <assert.h>
#include "POUS.h"
__DECLARE_GLOBAL(INT, TEST, EXTERNAL)
#include "POUS.c"
int main(void) {
  NATIVEBLOCK a = {0}, b = {0};
  OTHERBLOCK c = {0}; OTHERBLOCK_init__(&c, 0); c.INPUT.value = 3;
  OTHERBLOCK_body__(&c); assert(c.OUTPUT.value == 6);
  NATIVEBLOCK_init__(&a, 0); NATIVEBLOCK_init__(&b, 0);
  a.INPUT.value=1; b.INPUT.value=2;
  a.SAMPLES.value.table[0][0].value=17; a.SAMPLES.value.table[2][1].value=23;
  NATIVEBLOCK_body__(&a); NATIVEBLOCK_body__(&b);
  assert(a.COUNTER.value==11 && b.COUNTER.value==11);
  assert(a.OUTPUT.value==13 && b.OUTPUT.value==14);
  assert(a.RESULTS.value.table[0].value==17 && a.RESULTS.value.table[1].value==23);
  assert(a.DURATION.value.tv_sec==11 && a.LABEL.value.body[0]=='X');
  assert(a.UTCNOW.value.tv_sec==0 && !a.CLOCKVALID.value && a.CLOCKSTATUS.value==-1100);
  assert(TEST__EXTERNAL.value==2 && a.SHARED.value==1);
  NATIVEBLOCK_body__(&a);
  assert(a.COUNTER.value==12 && b.COUNTER.value==11 && a.SCRATCH.value==1);
  a.OUTPUT.flags=__IEC_FORCE_FLAG; a.OUTPUT.value=99;
  a.COUNTER.flags=__IEC_FORCE_FLAG; a.COUNTER.value=50;
  a.RESULTS.value.table[0].flags=__IEC_FORCE_FLAG; a.RESULTS.value.table[0].value=77;
  TEST__EXTERNAL.flags=__IEC_FORCE_FLAG;
  NATIVEBLOCK_body__(&a);
  assert(a.OUTPUT.value==99 && a.COUNTER.value==50 && TEST__EXTERNAL.value==3);
  assert(a.RESULTS.value.table[0].value==77);
  return 0;
}`,
      )
      run(gcc, ['-std=gnu11', '-Ilib', '-I.', '-c', join(root, 'host.c'), '-o', 'host.o'])
      run(gpp, [
        '-std=c++17',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-I../runtime',
        '-c',
        'eurosonic_cpp_nativeblock.cpp',
        '-o',
        'native.o',
      ])
      run(gpp, ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-c', 'eurosonic_cpp_otherblock.cpp', '-o', 'other.o'])
      run(gcc, ['-std=gnu11', '-c', '../runtime/plc_clock.c', '-o', 'clock.o'])
      run(gpp, ['host.o', 'native.o', 'other.o', 'clock.o', '-o', 'test.exe'])
      run(join(src, 'test.exe'), [])
      // Repeated generation must replace, never append. Removing C++ must remove
      // every generated translation unit from CMake's recursive source glob.
      const before = await readFile(join(src, 'eurosonic_cpp_nativeblock.cpp'), 'utf8')
      await writeEurosonicCppFiles(src, blocks)
      expect(await readFile(join(src, 'eurosonic_cpp_nativeblock.cpp'), 'utf8')).toBe(before)
      cpSync(join(src, 'POUS.arm.h'), join(src, 'POUS.h'))
      writeFileSync(join(root, 'fixture.json'), JSON.stringify({ root, src, block, blocks }))
      await writeEurosonicCppFiles(src, [])
      expect((await readdir(src)).filter((name) => name.startsWith('eurosonic_cpp_'))).toEqual([])
      expect(await readFile(join(src, 'c_blocks.h'), 'utf8')).toBe('// Empty file\n')
      // Leave a reproducible fixture for the separate complete ARM build.
      await writeEurosonicCppFiles(src, blocks)
    },
    120000,
  )
})
