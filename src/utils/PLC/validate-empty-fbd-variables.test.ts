import type { PLCProjectData } from '@root/types/PLC/open-plc'

import { findEmptyFbdVariables } from './validate-empty-fbd-variables'

const projectWithNodes = (nodes: unknown[], edges: unknown[] = []): PLCProjectData =>
  ({
    pous: [
      {
        type: 'program',
        data: {
          name: 'main',
          body: { language: 'fbd', value: { name: 'main', rung: { comment: '', nodes, edges } } },
          variables: [],
          documentation: '',
        },
      },
    ],
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: [] } },
  }) as unknown as PLCProjectData

const variableNode = (id: string, type: string, name: string, x = 0, y = 0) => ({
  id,
  type,
  position: { x, y },
  data: { variable: { name } },
})

describe('findEmptyFbdVariables', () => {
  it('reports unnamed FBD variables and their position', () => {
    expect(findEmptyFbdVariables(projectWithNodes([variableNode('input', 'input-variable', '  ', 16, 32)]))).toEqual([
      { pouName: 'main', kind: 'input', connectedTo: null, x: 16, y: 32 },
    ])
  })

  it('describes the block connected to an unnamed output', () => {
    const block = {
      id: 'block',
      type: 'block',
      position: { x: 0, y: 0 },
      data: { variable: { name: 'BLINK0' }, variant: { name: 'BLINK' } },
    }
    const output = variableNode('output', 'output-variable', '')
    const edge = { source: 'block', sourceHandle: 'Q', target: 'output', targetHandle: 'in' }

    expect(findEmptyFbdVariables(projectWithNodes([block, output], [edge]))[0].connectedTo).toBe('"Q" of "BLINK0"')
  })

  it('ignores named and non-variable nodes', () => {
    const nodes = [variableNode('input', 'input-variable', 'T#100ms'), { id: 'comment', type: 'comment', position: { x: 0, y: 0 } }]
    expect(findEmptyFbdVariables(projectWithNodes(nodes))).toEqual([])
  })
})
