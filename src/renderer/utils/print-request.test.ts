import { gvlFixture } from '../../../scripts/eurosonic/fixtures/gvl'
import type { RootState } from '../store'
import { buildPrintRequest, defaultPrintPage, PrintSelection } from './print-request'

const state = () =>
  ({
    project: {
      meta: { name: 'Unsaved project' },
      data: {
        dataTypes: [],
        configuration: { resource: { globalVariables: [], tasks: [], instances: [] } },
        pous: [
          {
            type: 'function-block',
            data: {
              name: 'CppBlink',
              variables: [],
              body: { language: 'cpp', value: 'void loop() { Lamp = !Lamp; }' },
            },
          },
          {
            type: 'program',
            data: {
              name: 'logic',
              variables: [],
              body: { language: 'fbd', value: { name: 'logic', rung: { comment: 'old', nodes: [], edges: [] } } },
            },
          },
        ],
      },
    },
    editor: {
      type: 'plc-textual',
      meta: { name: 'CppBlink' },
      variable: { display: 'code', code: 'VAR_OUTPUT\n Lamp : BOOL\nEND_VAR' },
    },
    editors: [],
    fbdFlows: [{ name: 'logic', rung: { comment: 'unsaved diagram', nodes: [], edges: [] } }],
    ladderFlows: [],
  }) as unknown as RootState
const selection = (): PrintSelection => ({
  names: ['CppBlink', 'logic'],
  includeConfiguration: true,
  page: structuredClone(defaultPrintPage),
  mode: 'normal',
  pagePolicy: 'new-page-per-pou',
})

it('prints unsaved C++ and incomplete declaration text without committing or altering the project', () => {
  const source = state()
  const before = structuredClone(source)
  const request = buildPrintRequest(source, selection())
  const cpp = request.pous.find((pou) => pou.kind === 'cpp')
  expect(cpp?.declarations?.[1].runs[0].text).toBe(' Lamp : BOOL')
  expect(cpp && 'lines' in cpp && cpp.lines[0].runs[0].text).toContain('Lamp = !Lamp')
  expect(source).toEqual(before)
})

it('uses current flow store geometry and detaches the preview from future edits', () => {
  const source = state()
  const request = buildPrintRequest(source, selection())
  source.fbdFlows[0].rung.comment = 'later edit'
  const fbd = request.pous.find((pou) => pou.kind === 'fbd')
  expect(fbd?.kind === 'fbd' && fbd.rung.comment).toBe('unsaved diagram')
})

it('includes pending global declaration text even if it is not parseable', () => {
  const source = state()
  source.editors = [
    {
      type: 'plc-resource',
      meta: { name: 'Resource', path: '/project.json' },
      variable: { display: 'code', code: 'VAR_GLOBAL\n INCOMPLETE' },
      task: { display: 'code' },
      instance: { display: 'code' },
    },
  ]
  expect(JSON.stringify(buildPrintRequest(source, selection()))).toContain('INCOMPLETE')
})

it('honors selection and does not silently skip unsupported SFC', () => {
  expect(buildPrintRequest(state(), { ...selection(), names: [], includeConfiguration: false }).pous).toEqual([])
  const source = state()
  source.project.data.pous[0].data.body = { language: 'sfc', value: '' }
  expect(() => buildPrintRequest(source, selection())).toThrow('not supported')
})

it('formats configuration as readable tables with IEC types and preserves the source', () => {
  const source = state()
  source.project.data.configuration.resource.tasks = [
    { name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 1 },
  ]
  source.project.data.configuration.resource.instances = [{ name: 'instance0', task: 'task0', program: 'main' }]
  source.project.data.dataTypes = [
    {
      name: 'CONFIG',
      derivation: 'structure',
      variable: [
        {
          name: 'Threshold',
          type: { definition: 'base-type', value: 'dint' },
          initialValue: { simpleValue: { value: '10' } },
        },
      ],
    },
    {
      name: 'VALUES',
      derivation: 'array',
      dimensions: [{ dimension: '0..7' }],
      baseType: { definition: 'user-data-type', value: 'CONFIG' },
    },
    {
      name: 'Mode',
      derivation: 'enumerated',
      values: [{ description: 'Idle' }, { description: 'Run' }],
      initialValue: 'Idle',
    },
  ]
  const before = structuredClone(source)
  const config = buildPrintRequest(source, selection()).pous[0]
  expect(config.kind).toBe('configuration')
  if (config.kind !== 'configuration') throw new Error('Configuration missing')
  expect(config.tables.find((t) => t.title === 'Tasks')?.rows).toEqual([['task0', 'Cyclic', 'T#10ms', '1']])
  expect(config.tables.find((t) => t.title.includes('CONFIG'))?.rows).toEqual([['Threshold', 'DINT', '10']])
  expect(config.tables.find((t) => t.title.includes('VALUES'))?.rows).toEqual([['0..7', 'CONFIG', '']])
  expect(config.tables.find((t) => t.title.includes('Mode'))?.rows).toEqual([['Idle, Run', 'Idle']])
  expect(source).toEqual(before)
})

it('prints valid GVLs as tables and incomplete drafts as text without losing edits', () => {
  const source = state()
  source.project.data.globalVariableLists = gvlFixture().globalVariableLists
  source.project.data.globalVariableLists![0].variablesText = 'VAR_GLOBAL\n Lamp AT %QX120.6 : BOOL;\nEND_VAR'
  source.project.data.globalVariableLists![1].variablesText = 'VAR_GLOBAL RETAIN\n Count :'
  const before = structuredClone(source)
  const request = buildPrintRequest(source, selection())
  const io = request.pous.find((p) => p.name.endsWith('GVL_IO'))
  expect(io?.kind === 'configuration' && io.tables[0].rows[0]).toEqual(['Lamp', 'BOOL', '%QX120.6', '', '', ''])
  expect(request.pous.find((p) => p.name.endsWith('GVL_State (draft)'))?.declarations?.[1].runs[0].text).toBe(
    ' Count :',
  )
  expect(source).toEqual(before)
})
