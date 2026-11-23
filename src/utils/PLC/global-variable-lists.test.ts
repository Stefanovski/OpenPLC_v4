import { PLCProjectDataSchema } from '@root/types/PLC/open-plc'

import { gvlFixture, multiRetainGvlFixture } from '../../../scripts/eurosonic/fixtures/gvl'
import { generateIecVariablesToString } from '../generate-iec-variables-to-string'
import { displayGvlPath, lowerGlobalVariableLists, parseGvlDeclarations } from './global-variable-lists'
import { XmlGenerator } from './xml-generator'

test('lowering preserves original project, addresses, retained values and source positions', () => {
  const project = gvlFixture(),
    before = structuredClone(project)
  const lowered = lowerGlobalVariableLists(project)
  expect(project).toEqual(before)
  expect(lowered.globalVariableLists).toBeUndefined()
  expect(lowered.configuration.resource.globalVariables[0]).toMatchObject({ name: 'GVL_IO_Lamp', location: '%QX120.6' })
  expect(lowered.configuration.resource.globalVariables.at(-1)).toMatchObject({
    name: 'GVL_State_Count',
    retain: true,
    initialValue: '42',
  })
  expect(lowered.pous[0].data.variables).toHaveLength(6)
  expect(
    lowered.pous[0].data.variables.every((v) => v.class === 'external' && !v.location && !v.retain && !v.initialValue),
  ).toBe(true)
  expect(lowered.pous[0].data.body.value).toBe(
    (project.pous[0].data.body.value as string).replace(/GVL_(IO|State)\./g, 'GVL_$1_'),
  )
  expect(lowerGlobalVariableLists(lowered)).toBe(lowered)
})

test('old project schema, input and XML are unchanged without GVLs', () => {
  const project = gvlFixture()
  delete project.globalVariableLists
  project.pous[0].data.body.value = ''
  expect(PLCProjectDataSchema.parse(project)).not.toHaveProperty('globalVariableLists')
  expect(lowerGlobalVariableLists(project)).toBe(project)
  expect(XmlGenerator({ ...project, globalVariableLists: [] }).data).toBe(XmlGenerator(project).data)
})

test('XML emits actual located globals and separate retained blocks', () => {
  const xml = XmlGenerator(gvlFixture()).data!
  expect(xml).toContain('name="GVL_IO_Lamp" address="%QX120.6"')
  expect(xml).toContain('<globalVars retain="true">')
  expect(xml).toContain('GVL_State_Count := GVL_State_Count + 1;')
  expect(xml).not.toContain('<struct>')
})

test.each(['old-editor', 'codesys'] as const)(
  '%s preserves RETAIN for every global across multiple lists',
  (format) => {
    const result = XmlGenerator(multiRetainGvlFixture(), format)
    expect(result.ok).toBe(true)
    const blocks = [...result.data!.matchAll(/<globalVars retain="true">([\s\S]*?)<\/globalVars>/g)]
    expect(blocks).toHaveLength(5)
    for (const block of blocks) expect(block[1].match(/<variable /g)).toHaveLength(1)
    const retained = blocks.map((block) => block[1]).join('')
    for (const name of [
      'GVL_State_Count',
      'GVL_State_Marker',
      'GVL_Second_Count',
      'GVL_Second_Enabled',
      'GVL_Second_Signed',
    ])
      expect(retained).toContain(`name="${name}"`)
    for (const name of ['GVL_IO_Lamp', 'GVL_State_Volatile', 'GVL_Second_Scratch'])
      expect(retained).not.toContain(`name="${name}"`)
  },
)

test('strict GVL declarations roundtrip RETAIN and AT; invalid pending edits cannot compile', () => {
  const project = gvlFixture()
  const text = 'VAR_GLOBAL\nLamp AT %QX120.6 : BOOL;\nEND_VAR\nVAR_GLOBAL RETAIN\nCount : UDINT := 42;\nEND_VAR'
  const vars = parseGvlDeclarations(text, project)
  expect(parseGvlDeclarations(generateIecVariablesToString(vars), project)).toEqual(vars)
  for (const invalid of [
    'VAR_GLOBAL\nLamp : BOOL;',
    'VAR\nLamp : BOOL;\nEND_VAR',
    'junk',
    'VAR_GLOBAL RETAIN\nLamp AT %QX120.6 : BOOL;\nEND_VAR',
  ])
    expect(() => parseGvlDeclarations(invalid, project)).toThrow()
  project.globalVariableLists![0].variablesText = 'broken unsaved text'
  expect(() => lowerGlobalVariableLists(project)).toThrow()
  expect(PLCProjectDataSchema.parse(project).globalVariableLists![0].variablesText).toBe('broken unsaved text')
})

test.each(['GVL_IO', 'GVL_IO_Lamp', 'gvl_io_lamp'])('rejects collisions with existing POU variables: %s', (name) => {
  const project = gvlFixture()
  project.pous[0].data.variables.push({
    name,
    type: { definition: 'base-type', value: 'bool' },
    class: 'local',
    location: '',
    documentation: '',
  })
  expect(() => lowerGlobalVariableLists(project)).toThrow(/collision/)
})

test('case insensitive references skip comments and strings, preserve line/column offsets', () => {
  const project = gvlFixture()
  const code =
    "IF TRUE THEN gvl_io . lamp := FALSE; END_IF; // GVL_IO.Input\n(* GVL_IO.Lamp (* nested *) *)\n'GVL_IO.Lamp';"
  project.pous[0].data.body.value = code
  expect(lowerGlobalVariableLists(project).pous[0].data.body.value).toBe(code.replace('gvl_io . lamp', 'GVL_IO_Lamp  '))
  project.pous[0].data.body.value = 'GVL_IO.NoSuchMember := 1;'
  expect(() => lowerGlobalVariableLists(project)).toThrow(/Unknown GVL/)
  project.pous[0].data.body.value = 'GVL_IO\n.Lamp := TRUE;'
  expect(() => lowerGlobalVariableLists(project)).toThrow(/one line/)
})

test('C++ code receives external bindings and strings/comments remain literal', () => {
  const project = gvlFixture()
  project.pous[0].data.body = {
    language: 'cpp',
    value: 'void loop() { GVL_IO.Lamp = true; } // GVL_IO.Input\nconst char* x = R"tag(GVL_IO.Lamp)tag";',
  }
  const result = lowerGlobalVariableLists(project).pous[0].data
  expect(result.variables.map((v) => v.name)).toEqual(['GVL_IO_Lamp'])
  expect(result.body.value).toContain('GVL_IO_Lamp = true')
  expect(result.body.value).toContain('R"tag(GVL_IO.Lamp)tag"')
})

test('display mapping keeps global ownership and does not accidentally match alias prefixes', () => {
  expect(displayGvlPath('CONFIG0.GVL_STATE_COUNT', gvlFixture())).toBe('CONFIG0.GVL_State.Count')
  expect(displayGvlPath('CONFIG0__GVL_IO_LAMP', gvlFixture())).toBe('CONFIG0__GVL_IO.Lamp')
  expect(displayGvlPath('CONFIG0.GVL_STATE_COUNTER', gvlFixture())).toBe('CONFIG0.GVL_STATE_COUNTER')
})
