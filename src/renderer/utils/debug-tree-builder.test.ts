import type { PLCProject, PLCVariable } from '@root/types/PLC/open-plc'

import { buildDebugTree } from './debug-tree-builder'
import type { DebugVariable } from './parse-debug-file'

const structVariable: PLCVariable = {
  name: 'my_struct',
  class: 'local',
  type: { definition: 'user-data-type', value: 'OuterStruct' },
  location: '',
  documentation: '',
}

const project = {
  data: {
    pous: [],
    dataTypes: [
      {
        name: 'OuterStruct',
        derivation: 'structure',
        variable: [{ name: 'inner', type: { definition: 'user-data-type', value: 'InnerStruct' } }],
      },
      {
        name: 'InnerStruct',
        derivation: 'structure',
        variable: [{ name: 'value', type: { definition: 'base-type', value: 'int' } }],
      },
    ],
  },
} as unknown as PLCProject

function debugVariable(name: string): DebugVariable {
  return { name, type: 'INT', index: 7 }
}

describe('buildDebugTree', () => {
  it.each([
    ['RES0__INSTANCE0.MY_STRUCT.INNER.VALUE', 'RES0__INSTANCE0.MY_STRUCT.INNER'],
    ['RES0__INSTANCE0.MY_STRUCT.value.INNER.value.VALUE', 'RES0__INSTANCE0.MY_STRUCT.value.INNER'],
  ])('resolves nested structure fields emitted as %s', (debugPath, expectedInnerPath) => {
    const tree = buildDebugTree(structVariable, 'main', 'instance0', [debugVariable(debugPath)], project)
    const innerNode = tree.children?.[0]
    const valueNode = innerNode?.children?.[0]

    expect(innerNode?.fullPath).toBe(expectedInnerPath)
    expect(valueNode).toMatchObject({ fullPath: debugPath, debugIndex: 7, type: 'INT' })
  })

  it('maps IEC array bounds to zero-based MatIEC table offsets', () => {
    const arrayVariable: PLCVariable = {
      name: 'samples',
      class: 'local',
      type: {
        definition: 'array',
        value: 'ARRAY [-2..0] OF INT',
        data: {
          baseType: { definition: 'base-type', value: 'int' },
          dimensions: [{ dimension: '-2..0' }],
        },
      },
      location: '',
      documentation: '',
    }
    const variables = [0, 1, 2].map((offset) => debugVariable(`RES0__INSTANCE0.SAMPLES.value.table[${offset}]`))

    const tree = buildDebugTree(arrayVariable, 'main', 'instance0', variables, project)

    expect(tree.children?.map((child) => [child.compositeKey, child.fullPath])).toEqual([
      ['main:samples[-2]', 'RES0__INSTANCE0.SAMPLES.value.table[0]'],
      ['main:samples[-1]', 'RES0__INSTANCE0.SAMPLES.value.table[1]'],
      ['main:samples[0]', 'RES0__INSTANCE0.SAMPLES.value.table[2]'],
    ])
  })

  it('uses the CONFIG0 global path for external arrays', () => {
    const arrayVariable: PLCVariable = {
      name: 'global_values',
      class: 'external',
      type: {
        definition: 'array',
        value: 'ARRAY [1..1] OF DINT',
        data: {
          baseType: { definition: 'base-type', value: 'dint' },
          dimensions: [{ dimension: '1..1' }],
        },
      },
      location: '',
      documentation: '',
    }
    const path = 'CONFIG0__GLOBAL_VALUES.value.table[0]'

    const tree = buildDebugTree(arrayVariable, 'main', 'instance0', [debugVariable(path)], project)

    expect(tree.children?.[0]).toMatchObject({ compositeKey: 'main:global_values[1]', fullPath: path, debugIndex: 7 })
  })
})
