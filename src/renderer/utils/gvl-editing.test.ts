import { gvlFixture } from '../../../scripts/eurosonic/fixtures/gvl'
import { lowerGlobalVariableLists, parseGvlDeclarations } from '../../utils/PLC/global-variable-lists'
import { duplicateGvl, editGvlCell, gvlFromText } from './gvl-editing'

test('table editing preserves other IO mappings, RETAIN, debug selections and source project', () => {
  const project = gvlFixture()
  const original = structuredClone(project)
  const list = project.globalVariableLists![0]
  list.variables[0].debug = true
  const changed = gvlFromText(list, editGvlCell(list, 0, 'location', '%QX120.7'), project)
  expect(changed.variables[0]).toMatchObject({ location: '%QX120.7', debug: true })
  expect(changed.variables[1].location).toBe('%IX100.0')
  expect(project.globalVariableLists![0].variables[0].location).toBe(
    original.globalVariableLists![0].variables[0].location,
  )
  const retained = project.globalVariableLists![1]
  const edited = gvlFromText(retained, editGvlCell(retained, 1, 'initialValue', '123'), project)
  expect(edited.variables[1]).toMatchObject({ retain: true, initialValue: '123', type: { value: 'udint' } })
})

test('invalid drafts are preserved verbatim and rejected by compilation and duplication', () => {
  const project = gvlFixture()
  const list = project.globalVariableLists![0]
  const invalid = editGvlCell(list, 0, 'retain', true)
  const changed = gvlFromText(list, invalid, project)
  expect(changed.variablesText).toBe(invalid)
  expect(changed.variables).toEqual(list.variables)
  project.globalVariableLists![0] = changed
  expect(() => lowerGlobalVariableLists(project)).toThrow()
  expect(() => duplicateGvl(project, changed)).toThrow()
})

test('duplicates clear addresses and debug flags without mutating original or losing retained initial values', () => {
  const project = gvlFixture()
  project.globalVariableLists![0].variables[0].debug = true
  const before = structuredClone(project)
  const copy = duplicateGvl(project, project.globalVariableLists![0])
  expect(copy.name).toBe('GVL_IO_Copy')
  expect(copy.variables.every((v) => v.location === '' && v.debug === false)).toBe(true)
  expect(project).toEqual(before)
  project.globalVariableLists!.push(copy)
  expect(duplicateGvl(project, project.globalVariableLists![0]).name).toBe('GVL_IO_Copy2')
  const retained = duplicateGvl(project, project.globalVariableLists![1])
  expect(parseGvlDeclarations(retained.variablesText!, project)[1]).toMatchObject({ retain: true, initialValue: '42' })
})

test('copy names avoid case-insensitive global and generated alias collisions', () => {
  const project = gvlFixture()
  project.configuration.resource.globalVariables.push({
    name: 'gvl_io_copy_lamp',
    type: { definition: 'base-type', value: 'bool' },
    location: '',
    documentation: '',
  })
  expect(duplicateGvl(project, project.globalVariableLists![0]).name).toBe('GVL_IO_Copy2')
})
