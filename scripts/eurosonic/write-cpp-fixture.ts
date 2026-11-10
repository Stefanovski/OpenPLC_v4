import { readFile } from 'node:fs/promises'

import { writeEurosonicCppFiles } from '../../src/main/modules/compiler/eurosonic-cpp'
import type { CppPouData } from '../../src/utils/cpp/generateCBlocksCode'

async function main() {
  const fixture = JSON.parse(await readFile(process.argv[2], 'utf8')) as {
    src: string
    block?: CppPouData
    blocks?: CppPouData[]
  }
  await writeEurosonicCppFiles(fixture.src, fixture.blocks ?? (fixture.block ? [fixture.block] : []))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
