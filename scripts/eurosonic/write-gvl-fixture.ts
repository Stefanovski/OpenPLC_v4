import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prepareProjectForIecDebug } from '../../src/main/modules/compiler/iec-debug'
import { addCppLocalVariables } from '../../src/utils/cpp/addCppLocalVariables'
import { generateEurosonicCppST } from '../../src/utils/cpp/eurosonic'
import { lowerGlobalVariableLists } from '../../src/utils/PLC/global-variable-lists'
import { XmlGenerator } from '../../src/utils/PLC/xml-generator'
import { gvlFixture } from './fixtures/gvl'

async function main() {
  let project = gvlFixture()
  if (process.argv.includes('--cpp')) {
    project.pous.unshift({
      type: 'function-block',
      data: {
        name: 'GvlCpp',
        language: 'cpp',
        documentation: '',
        variables: [],
        body: {
          language: 'cpp',
          value: 'void setup() {}\nvoid loop() { GVL_IO.Lamp = GVL_IO.Input; GVL_State.Count += 1; }',
        },
      },
    })
    project.pous[1].data.variables.push({
      name: 'Bridge',
      class: 'local',
      type: { definition: 'derived', value: 'GvlCpp' },
      location: '',
      documentation: '',
    })
    const mainBody = project.pous[1].data.body
    if (mainBody.language !== 'st') throw new Error('Expected ST fixture program')
    mainBody.value += '\nBridge();'
  }
  project = lowerGlobalVariableLists(project)
  const blocks = project.pous
    .filter((p) => p.data.body.language === 'cpp')
    .map((p) => ({ name: p.data.name, code: p.data.body.value, variables: p.data.variables }))
  project = addCppLocalVariables(project)
  for (const pou of project.pous)
    if (pou.data.body.language === 'cpp')
      pou.data.body = {
        language: 'st',
        value: generateEurosonicCppST(pou.data.name, pou.data.variables, pou.data.body.value),
      }
  await writeFile(join(process.argv[2], 'cpp-fixture.json'), JSON.stringify(blocks))
  const prepared = process.argv.includes('--debug')
    ? prepareProjectForIecDebug(project)
    : { projectData: project, sourceFiles: [] }
  const xml = XmlGenerator(prepared.projectData)
  if (!xml.ok || !xml.data) throw new Error(xml.message)
  await writeFile(join(process.argv[2], 'plc.xml'), xml.data)
  for (const file of prepared.sourceFiles) await writeFile(join(process.argv[2], file.fileName), file.content)
}
main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
