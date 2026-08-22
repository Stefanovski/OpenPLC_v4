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
})
