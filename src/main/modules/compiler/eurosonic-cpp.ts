import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  extractEurosonicCppTypes,
  generateEurosonicCppHeader,
  generateEurosonicCppSource,
} from '@root/utils/cpp/eurosonic'
import type { CppPouData } from '@root/utils/cpp/generateCBlocksCode'

export const writeEurosonicCppFiles = async (sourceDirectory: string, pous: CppPouData[]) => {
  const names = new Set<string>()
  for (const pou of pous) {
    const name = pou.name.toLowerCase()
    if (!/^[a-z][a-z0-9_]*$/.test(name) || names.has(name)) throw new Error(`Invalid C++ POU name: ${pou.name}`)
    names.add(name)
  }
  // Render before changing files, so validation errors do not leave a partial set.
  const sources = pous.map((pou) => ({
    name: `eurosonic_cpp_${pou.name.toLowerCase()}.cpp`,
    code: generateEurosonicCppSource([pou]),
  }))
  const types = pous.length ? extractEurosonicCppTypes(await readFile(join(sourceDirectory, 'POUS.h'), 'utf8')) : ''
  for (const name of await readdir(sourceDirectory)) {
    if (/^eurosonic_cpp_[a-z0-9_]+\.cpp$/.test(name) || name === 'eurosonic_cpp_types.h') {
      await rm(join(sourceDirectory, name))
    }
  }
  // Match the existing empty template for projects without C++.
  await writeFile(
    join(sourceDirectory, 'c_blocks.h'),
    pous.length ? generateEurosonicCppHeader(pous) : '// Empty file\n',
  )
  if (!pous.length) return
  await writeFile(join(sourceDirectory, 'eurosonic_cpp_types.h'), types)
  // External IEC variables need Config0's getter prototypes before POU init.
  // The regular Eurosonic precompile step otherwise adds only POUS.h.
  const pousPath = join(sourceDirectory, 'POUS.c')
  const body = await readFile(pousPath, 'utf8')
  if (!body.includes('#include "Config0.h"')) {
    await writeFile(pousPath, `#include "POUS.h"\n#include "Config0.h"\n${body}`)
  }
  for (const source of sources) await writeFile(join(sourceDirectory, source.name), source.code)
}
