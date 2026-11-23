import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'

import type { IecDebugMetadata } from '../../../types/PLC/iec-debug'
import type { PlcDebugExecute } from '../../../types/plc-operations/debugger'
import { addCppLocalVariables } from '../../../utils/cpp/addCppLocalVariables'
import { generateEurosonicCppST } from '../../../utils/cpp/eurosonic'
import { displayGvlPath, lowerGlobalVariableLists } from '../../../utils/PLC/global-variable-lists'
import { wrapUnsupportedComments } from '../../../utils/PLC/wrap-unsupported-comments'
import { XmlGenerator } from '../../../utils/PLC/xml-generator'
import {
  IEC_DEBUG_METADATA_FILE,
  parseXml2stSourceMap,
  prepareProjectForIecDebug,
  XML2ST_SOURCE_MAP_FILE,
} from '../../modules/compiler/iec-debug'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const canonicalXml = (xml: string) =>
  xml.replace(/\b(?:creationDateTime|modificationDateTime)="[^"]*"/g, '').replace(/\r\n/g, '\n')
/** Reconstructs compiler input in memory only. No transpiler, compiler, file write or upload. */
export function debugProjectSources(request: Pick<PlcDebugExecute, 'data'>) {
  const data = addCppLocalVariables(structuredClone(lowerGlobalVariableLists(request.data)))
  for (const pou of data.pous) {
    if (pou.data.body.language === 'python') throw new Error('Python is not supported by active PLC debugging.')
    if (pou.data.body.language === 'cpp')
      pou.data.body = {
        language: 'st',
        value: generateEurosonicCppST(pou.data.name, pou.data.variables, pou.data.body.value),
      }
    else if (pou.data.body.language === 'st' || pou.data.body.language === 'il')
      pou.data.body.value = wrapUnsupportedComments(pou.data.body.value)
  }
  const prepared = prepareProjectForIecDebug(data)
  const xml = XmlGenerator(prepared.projectData, 'old-editor')
  if (!xml.ok || typeof xml.data !== 'string')
    throw new Error('Cannot reconstruct project XML for source verification.')
  return { xml: xml.data, files: prepared.sourceFiles }
}
export async function loadVerifiedDebugSource(request: PlcDebugExecute) {
  const dir = join(request.projectPath, 'build', request.board, 'src')
  const expected = debugProjectSources(request)
  const [xml, st, map, raw] = await Promise.all(
    ['plc.xml', 'program.st', XML2ST_SOURCE_MAP_FILE, IEC_DEBUG_METADATA_FILE].map((name) =>
      readFile(join(dir, name), 'utf8'),
    ),
  )
  if (canonicalXml(expected.xml) !== canonicalXml(xml))
    throw new Error('Current project does not match local debug build. No compilation or download was started.')
  for (const file of expected.files) {
    if ((await readFile(join(dir, file.fileName), 'utf8')) !== file.content)
      throw new Error(
        'Current ST/C++ source differs from the debug build. Compile/download only by an explicit separate request.',
      )
  }
  const sourceMap = parseXml2stSourceMap(map, xml, st)
  const metadata = JSON.parse(raw) as IecDebugMetadata
  if (
    metadata.format !== 'eurosonic-plc-debug' ||
    metadata.version !== 1 ||
    metadata.id_algorithm !== 'fnv1a32' ||
    !Array.isArray(metadata.pous) ||
    !Array.isArray(metadata.variables) ||
    !Array.isArray(metadata.instances) ||
    !Array.isArray(metadata.statements) ||
    metadata.source_identity?.project_sha256 !== sourceMap.project_sha256 ||
    metadata.source_identity.st_sha256 !== sourceMap.st_sha256 ||
    metadata.source_identity.source_map_sha256 !== digest(map)
  )
    throw new Error('Debug metadata/source identity mismatch.')
  const md5 = st.match(/\(\*DBG:char md5\[\] = "([a-fA-F0-9]{32})";?\*\)/)?.[1]
  if (!md5) throw new Error('Local debug build has no program MD5.')
  if (createHash('md5').update(st.slice(0, sourceMap.st_length)).digest('hex') !== md5.toLowerCase())
    throw new Error('Program MD5 does not match the verified ST source.')
  for (const file of expected.files) {
    if (!st.slice(0, sourceMap.st_length).includes(`EUROSONIC_SOURCE_SHA256:${digest(file.content)}`))
      throw new Error('Debug build lacks source-bound identity. Explicitly rebuild/download before connecting.')
  }
  return {
    metadata: {
      ...metadata,
      variables: metadata.variables.map((v) => ({ ...v, path: displayGvlPath(v.path, request.data) })),
    },
    md5: md5.toLowerCase(),
    identity: digest(raw + st + expected.files.map((f) => f.content).join('\0')),
  }
}
