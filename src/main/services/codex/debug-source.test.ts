import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { CodexDebugExecute } from '../../../types/IPC/codex-debug-control'
import { enrichIecDebugMetadata, type Xml2stSourceMap } from '../../modules/compiler/iec-debug'
import { debugProjectSources, loadVerifiedDebugSource } from './debug-source'

const hash = (s: string, algorithm = 'sha256') => createHash(algorithm).update(s).digest('hex')
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-debug-source-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
function request(): CodexDebugExecute {
  return {
    projectPath: root,
    board: 'Eurosonic_Gen2_8KW',
    host: '192.0.2.1',
    sessionId: null,
    command: { operation: 'connect', variables: [], statementId: 0 },
    confirmExecution: false,
    data: {
      pous: [
        {
          type: 'program',
          data: {
            name: 'main',
            language: 'st',
            documentation: '',
            variables: [],
            body: { language: 'st', value: ';' },
          },
        },
      ],
      dataTypes: [],
      configuration: {
        resource: {
          globalVariables: [],
          tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 }],
          instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
        },
      },
    },
  }
}
async function artifacts(r: CodexDebugExecute) {
  const generated = debugProjectSources(r),
    dir = join(root, 'build', r.board, 'src')
  await mkdir(dir, { recursive: true })
  const st =
    'PROGRAM MAIN\n' +
    generated.files
      .map((f) => `(* EUROSONIC_SOURCE_SHA256:${hash(f.content)} *)\n{#include "${f.fileName}"}`)
      .join('\n') +
    '\nEND_PROGRAM\n'
  const map = JSON.stringify({
    format: 'eurosonic-xml2st-source-map',
    version: 1,
    project_sha256: hash(generated.xml),
    st_sha256: hash(st),
    st_length: st.length,
    chunks: [],
  })
  const metadata = {
    format: 'eurosonic-plc-debug',
    version: 1,
    id_algorithm: 'fnv1a32',
    pous: [],
    variables: [],
    instances: [],
    statements: [],
    source_identity: { project_sha256: hash(generated.xml), st_sha256: hash(st), source_map_sha256: hash(map) },
  }
  const files = [
    ...generated.files,
    { fileName: 'plc.xml', content: generated.xml },
    { fileName: 'program.st', content: st + `\n(*DBG:char md5[] = "${hash(st, 'md5')}";*)` },
    { fileName: 'program.source-map.json', content: map },
    { fileName: 'program.debug.json', content: JSON.stringify(metadata) },
  ]
  for (const file of files) await writeFile(join(dir, file.fileName), file.content)
  return { dir, files, st, map, metadata }
}
test('verifies source identities without writing files or modifying the project', async () => {
  const r = request(),
    before = structuredClone(r),
    a = await artifacts(r)
  expect(await loadVerifiedDebugSource(r)).toMatchObject({ md5: hash(a.st, 'md5') })
  expect(r).toEqual(before)
  for (const file of a.files) expect(await readFile(join(a.dir, file.fileName), 'utf8')).toBe(file.content)
})
test.each(['buffer', 'include', 'xml', 'map', 'metadata', 'md5'])(
  'rejects inconsistent %s before contacting a PLC',
  async (mode) => {
    const r = request(),
      a = await artifacts(r)
    if (mode === 'buffer') r.data.pous[0].data.body = { language: 'st', value: '; (* edited *)' }
    const file =
      mode === 'include'
        ? 'main.st'
        : mode === 'xml'
          ? 'plc.xml'
          : mode === 'map'
            ? 'program.source-map.json'
            : mode === 'metadata'
              ? 'program.debug.json'
              : mode === 'md5'
                ? 'program.st'
                : null
    if (file) {
      const original = await readFile(join(a.dir, file), 'utf8')
      await writeFile(
        join(a.dir, file),
        mode === 'md5' ? original.replace(hash(a.st, 'md5'), 'a'.repeat(32)) : original + ' corrupted',
      )
    }
    await expect(loadVerifiedDebugSource(r)).rejects.toThrow()
  },
)
test('updated includes after an unsuccessful build cannot impersonate the old running build', async () => {
  const r = request(),
    a = await artifacts(r)
  r.data.pous[0].data.body = { language: 'st', value: '; (* changed body *)' }
  const changed = debugProjectSources(r)
  await writeFile(join(a.dir, 'main.st'), changed.files[0].content)
  // Even if the include file matches the current editor, the old project/MD5 must not pass.
  await expect(loadVerifiedDebugSource(r)).rejects.toThrow('does not match')
})
test('native C++ body changes change the generated program identity while preserving source files', () => {
  const r = request()
  r.data.pous.push({
    type: 'function-block',
    data: {
      name: 'Blink',
      language: 'cpp',
      documentation: '',
      variables: [],
      body: { language: 'cpp', value: 'void setup() {}\nvoid loop() {}' },
    },
  })
  const before = debugProjectSources(r)
  r.data.pous[1].data.body = { language: 'cpp', value: 'void setup() {}\nvoid loop() { int x = 1; }' }
  const after = debugProjectSources(r)
  expect(before.xml).not.toEqual(after.xml)
  expect(before.files[1].content).not.toEqual(after.files[1].content)
})

// Exercise the shipped converters in a disposable project, never a PLC or user build.
;(process.platform === 'win32' ? test : test.skip)(
  'shipped xml2st/MatIEC preserve body hashes and body-local debug locations',
  async () => {
    const r = request(),
      dir = join(root, 'build', r.board, 'src')
    r.data.pous[0].data.variables = [
      {
        name: 'Counter',
        class: 'local',
        type: { definition: 'base-type', value: 'udint' },
        location: '',
        initialValue: '',
        documentation: '',
      },
    ]
    r.data.pous[0].data.body = { language: 'st', value: 'Counter := Counter + 1;' }
    const generate = async () => {
      const source = debugProjectSources(r)
      await mkdir(dir, { recursive: true })
      await cp(join(process.cwd(), 'resources/sources/MatIEC/lib'), join(dir, 'lib'), { recursive: true })
      await writeFile(join(dir, 'plc.xml'), source.xml)
      for (const file of source.files) await writeFile(join(dir, file.fileName), file.content)
      const binary = (name: string) => join(process.cwd(), 'resources/bin/win32/x64', name + '.exe')
      const run = (name: string, args: string[]) =>
        execFileSync(binary(name), args, { cwd: dir, windowsHide: true, timeout: 30000, stdio: 'pipe' })
      run('xml2st', ['--generate-st', join(dir, 'plc.xml')])
      run('iec2c', ['-f', '-p', '-i', '-l', '-g', join(dir, 'program.st')])
      run('xml2st', ['--generate-debug', join(dir, 'program.st'), join(dir, 'VARIABLES.csv')])
      const map = await readFile(join(dir, 'program.source-map.json'), 'utf8'),
        raw = await readFile(join(dir, 'program.debug.json'), 'utf8'),
        m = JSON.parse(map) as Xml2stSourceMap
      await writeFile(
        join(dir, 'program.debug.json'),
        enrichIecDebugMetadata(raw, [], [], [], {
          schema_version: 1,
          project_sha256: m.project_sha256,
          st_sha256: m.st_sha256,
          source_map_sha256: hash(map),
          matiec_debug_sha256: hash(raw),
        }),
      )
      return loadVerifiedDebugSource(r)
    }
    const first = await generate()
    expect(first.metadata.statements.some((s) => s.file.endsWith('main.st') && s.line === 1)).toBe(true)
    r.data.pous[0].data.body = { language: 'st', value: 'Counter := Counter + 2;' }
    const second = await generate()
    expect(second.md5).not.toBe(first.md5)
  },
  60000,
)
