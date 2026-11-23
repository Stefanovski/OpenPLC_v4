import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { copyEurosonicLibs } from './eurosonic-libs'

const root = join(__dirname, '..', '..', '..', '..', 'resources', 'sources', 'eurosonic')

describe('copyEurosonicLibs', () => {
  let dir: string
  let project: string
  let build: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eurosonic-libs-'))
    project = join(dir, 'project')
    build = join(dir, 'build')
    await mkdir(project)
    await mkdir(build)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('does nothing without a libs folder', async () => {
    expect(await copyEurosonicLibs(project, build)).toBe(false)
    expect(await readdir(build)).toEqual([])
  })

  it('copies the whole folder, including headers, sub-folders and non-library files', async () => {
    await mkdir(join(project, 'libs', 'inc'), { recursive: true })
    await writeFile(join(project, 'libs', 'liba.a'), 'a')
    await writeFile(join(project, 'libs', 'a.h'), 'h')
    await writeFile(join(project, 'libs', 'inc', 'b.h'), 'b')
    await writeFile(join(project, 'libs', 'notes.txt'), 'n')
    expect(await copyEurosonicLibs(project, build)).toBe(true)
    expect((await readdir(join(build, 'libs'))).sort()).toEqual(['a.h', 'inc', 'liba.a', 'notes.txt'])
    expect(await readFile(join(build, 'libs', 'inc', 'b.h'), 'utf8')).toBe('b')
  })

  it('picks up a replaced library and drops a deleted one on the next build', async () => {
    await mkdir(join(project, 'libs'))
    await writeFile(join(project, 'libs', 'liba.a'), 'v1')
    await writeFile(join(project, 'libs', 'libb.a'), 'b')
    await copyEurosonicLibs(project, build)
    await writeFile(join(project, 'libs', 'liba.a'), 'v2')
    await rm(join(project, 'libs', 'libb.a'))
    await copyEurosonicLibs(project, build)
    expect(await readFile(join(build, 'libs', 'liba.a'), 'utf8')).toBe('v2')
    expect(await readdir(join(build, 'libs'))).toEqual(['liba.a'])
  })

  it('removes a stale copy when the project no longer has libs', async () => {
    await mkdir(join(build, 'libs'))
    await writeFile(join(build, 'libs', 'old.a'), 'x')
    expect(await copyEurosonicLibs(project, build)).toBe(false)
    expect(await readdir(build)).toEqual([])
  })

  it('never modifies the project files', async () => {
    await mkdir(join(project, 'libs'))
    await writeFile(join(project, 'libs', 'liba.a'), 'keep')
    await copyEurosonicLibs(project, build)
    expect(await readFile(join(project, 'libs', 'liba.a'), 'utf8')).toBe('keep')
  })

  it('rejects a libs entry that is a file', async () => {
    await writeFile(join(project, 'libs'), 'x')
    await expect(copyEurosonicLibs(project, build)).rejects.toThrow('must be a folder')
  })
})

// check_static_libs.py runs in the build, so it is tested with real invocations on synthetic
// ELF objects. Skipped where Python is not installed.
const python = spawnSync('python', ['--version']).status === 0 ? 'python' : null
const describePython = python ? describe : describe.skip

type Bytes = number[]

const text = (value: string): Bytes => Array.from(new TextEncoder().encode(value))
const u16 = (n: number): Bytes => [n & 0xff, (n >> 8) & 0xff]
const u32 = (n: number): Bytes => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
const zeros = (n: number): Bytes => new Array<number>(n).fill(0)

/** ELF32 ARM object whose only content is a .ARM.attributes section with the given Tag_ABI_VFP_args. */
const armObject = (vfpArgs: number | null, machine = 40): Bytes => {
  const file: Bytes = [
    5,
    ...text('cortex-m7\0'), // Tag_CPU_name: a string value the parser must skip
    ...(vfpArgs === null ? [] : [28, vfpArgs]),
    6,
    13, // Tag_CPU_arch = v7E-M
  ]
  const vendorBody: Bytes = [...text('aeabi\0'), 1, ...u32(file.length + 5), ...file]
  const attributes: Bytes = [...text('A'), ...u32(vendorBody.length + 4), ...vendorBody]
  const names = text('\0.ARM.attributes\0.shstrtab\0')
  const dataOffset = 52
  const namesOffset = dataOffset + attributes.length
  const tableOffset = Math.ceil((namesOffset + names.length) / 4) * 4
  const header: Bytes = zeros(52)
  header.splice(0, 7, 0x7f, 0x45, 0x4c, 0x46, 1, 1, 1) // magic, ELFCLASS32, little endian, version
  header.splice(16, 4, ...u16(1), ...u16(machine)) // ET_REL, e_machine
  header.splice(32, 4, ...u32(tableOffset))
  header.splice(46, 6, ...u16(40), ...u16(3), ...u16(2)) // shentsize, shnum, shstrndx
  const section = (name: number, type: number, offset: number, size: number): Bytes => {
    const s = zeros(40)
    s.splice(0, 8, ...u32(name), ...u32(type))
    s.splice(16, 8, ...u32(offset), ...u32(size))
    return s
  }
  return [
    ...header,
    ...attributes,
    ...names,
    ...zeros(tableOffset - namesOffset - names.length),
    ...zeros(40),
    ...section(1, 0x70000003, dataOffset, attributes.length),
    ...section(17, 3, namesOffset, names.length),
  ]
}

const archive = (members: Array<[string, Bytes]>): Bytes => {
  const parts: Bytes[] = [text('!<arch>\n')]
  const longNames = members.filter(([name]) => name.length > 15).map(([name]) => `${name}/\n`)
  let table = 0
  const push = (name: string, body: Bytes) => {
    const fields = [name.padEnd(16), '0'.padEnd(12), '0'.padEnd(6), '0'.padEnd(6), '644'.padEnd(8)]
    parts.push(text(fields.join('') + String(body.length).padEnd(10) + '\x60\n'), body)
    if (body.length % 2) parts.push(text('\n'))
  }
  push('/', zeros(4)) // symbol table, not an object
  if (longNames.length) push('//', text(longNames.join('')))
  for (const [name, body] of members) {
    if (name.length > 15) {
      push(`/${table}`, body)
      table += name.length + 2
    } else push(`${name}/`, body)
  }
  return parts.flat()
}

describePython('check_static_libs.py', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eurosonic-abi-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const check = async (...libraries: Array<[string, Bytes]>) => {
    const paths: string[] = []
    for (const [name, content] of libraries) {
      paths.push(join(dir, name))
      await writeFile(join(dir, name), Uint8Array.from(content))
    }
    return spawnSync(python as string, ['-I', join(root, 'check_static_libs.py'), ...paths], { encoding: 'utf8' })
  }

  it('accepts soft-float ARM objects, including long member names', async () => {
    const result = await check([
      'a.a',
      archive([
        ['a.o', armObject(0)],
        ['a_long_member_name_x.o', armObject(null)],
      ]),
    ])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('rejects a hard-float library, naming the library, the member and the fix', async () => {
    const result = await check(
      ['ok.a', archive([['a.o', armObject(0)]])],
      ['bad.a', archive([['a_long_member_name_x.o', armObject(1)]])],
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bad.a(a_long_member_name_x.o)')
    expect(result.stderr).toContain('hard-float ABI')
    expect(result.stderr).toContain('soft-float')
    expect(result.stderr).toContain('thumbv7em-none-eabi')
  })

  it('rejects an object for another architecture', async () => {
    const result = await check(['x86.a', archive([['a.o', armObject(0, 62)]])])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not an ARM object')
  })

  it('rejects a file that is not a static library', async () => {
    const result = await check(['junk.a', text('not an archive')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not a static library')
  })
})
