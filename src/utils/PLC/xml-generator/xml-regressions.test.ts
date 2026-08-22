import type { PLCDataType, PLCPou } from '@root/types/PLC/open-plc'

import { codeSysParseDataTypesToXML } from './codesys/data-type-xml'
import { codeSysParseInterface } from './codesys/pou-xml'
import { oldEditorParseDataTypesToXML } from './old-editor/data-type-xml'
import { oldEditorParseInterface } from './old-editor/pou-xml'
import { convertTypeToXml } from './old-editor/type-xml'

const stringPou = {
  type: 'program',
  data: {
    name: 'main',
    body: { language: 'st', value: '' },
    documentation: '',
    variables: [
      {
        name: 'message',
        class: 'local',
        type: { definition: 'base-type', value: 'STRING' },
      },
    ],
  },
} as unknown as PLCPou

const structureWithEmptyInitialValues = {
  name: 'Container',
  derivation: 'structure',
  variable: [
    {
      name: 'values',
      type: {
        definition: 'array',
        value: '',
        data: {
          baseType: { definition: 'base-type', value: 'REAL' },
          dimensions: [{ dimension: '0..3' }],
        },
      },
      initialValue: { simpleValue: { value: '' } },
    },
    {
      name: 'nested',
      type: { definition: 'derived', value: 'Nested' },
      initialValue: { simpleValue: { value: '' } },
    },
  ],
} as unknown as PLCDataType

const makeBaseXml = <T>() =>
  ({ project: { types: { dataTypes: { dataType: [] } } } }) as unknown as T

describe('PLCopen XML regressions', () => {
  it('serializes uppercase STRING using the lowercase PLCopen tag', () => {
    const uppercaseString = { definition: 'base-type', value: 'STRING' } as unknown as Parameters<
      typeof convertTypeToXml
    >[0]
    expect(convertTypeToXml(uppercaseString)).toEqual({ string: '' })
    expect(oldEditorParseInterface(stringPou).localVars?.variable?.[0].type).toEqual({ string: '' })
    expect(codeSysParseInterface(stringPou).localVars?.variable?.[0].type).toEqual({ string: '' })
  })

  it('omits blank struct initial values in the old editor XML format', () => {
    const xml = makeBaseXml<Parameters<typeof oldEditorParseDataTypesToXML>[0]>()
    const result = oldEditorParseDataTypesToXML(xml, [structureWithEmptyInitialValues])
    const structure = result.project.types.dataTypes.dataType[0]

    if (!('struct' in structure.baseType)) throw new Error('Expected structure data type')
    structure.baseType.struct?.variable.forEach((variable) => expect(variable.initialValue).toBeUndefined())
  })

  it('omits blank struct initial values in the CODESYS XML format', () => {
    const xml = makeBaseXml<Parameters<typeof codeSysParseDataTypesToXML>[0]>()
    const result = codeSysParseDataTypesToXML(xml, [structureWithEmptyInitialValues])
    const structure = result.project.types.dataTypes.dataType[0]

    if (!('struct' in structure.baseType)) throw new Error('Expected structure data type')
    structure.baseType.struct?.variable.forEach((variable) => expect(variable.initialValue).toBeUndefined())
  })
})
