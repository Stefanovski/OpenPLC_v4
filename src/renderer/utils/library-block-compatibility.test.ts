import type { LibraryState } from '@root/renderer/store/slices'
import type { PLCProjectData } from '@root/types/PLC/open-plc'

import {
  findOutdatedLibraryBlocks,
  getLibraryBlockInterfaceChanges,
  resolveCurrentLibraryBlock,
  type ResolvedLibraryBlock,
} from './library-block-compatibility'

const currentWeldBlock: ResolvedLibraryBlock = {
  name: 'ES_GEN_WELD',
  type: 'function-block',
  variables: [
    { name: 'USON', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'USON_STATE', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
    { name: 'POWER', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
  ],
}

const oldWeldBlock: ResolvedLibraryBlock = {
  ...currentWeldBlock,
  variables: [
    { name: 'USON', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'USON_STATE', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
}

const libraries = {
  user: [],
  system: [{ pous: [currentWeldBlock] }],
} as unknown as LibraryState['libraries']

const buildProject = (variant: ResolvedLibraryBlock) =>
  ({
    dataTypes: [],
    pous: [
      {
        type: 'program',
        data: {
          name: 'fbdtest',
          language: 'fbd',
          documentation: '',
          variables: [],
          body: {
            language: 'fbd',
            value: {
              name: 'fbdtest',
              rung: {
                comment: '',
                edges: [],
                nodes: [
                  {
                    id: 'BLOCK-1',
                    type: 'block',
                    position: { x: 0, y: 0 },
                    draggable: true,
                    selectable: true,
                    data: { variant, variable: { name: 'ES_GEN_WELD2' } },
                  },
                ],
              },
            },
          },
        },
      },
    ],
  }) as unknown as PLCProjectData

describe('library block compatibility', () => {
  it('resolves a block from a system library', () => {
    expect(resolveCurrentLibraryBlock(libraries, [], 'es_gen_weld', 'function-block')).toBe(currentWeldBlock)
  })

  it('reports changed and newly added ports', () => {
    expect(getLibraryBlockInterfaceChanges(oldWeldBlock, currentWeldBlock)).toEqual([
      {
        name: 'USON_STATE',
        kind: 'changed',
        previous: { class: 'output', type: 'BOOL' },
        current: { class: 'output', type: 'UINT' },
      },
      {
        name: 'POWER',
        kind: 'added',
        current: { class: 'output', type: 'UINT' },
      },
    ])
  })

  it('finds an outdated system-library instance in an FBD POU', () => {
    const outdatedBlocks = findOutdatedLibraryBlocks(buildProject(oldWeldBlock), libraries)

    expect(outdatedBlocks).toHaveLength(1)
    expect(outdatedBlocks[0]).toMatchObject({
      pouName: 'fbdtest',
      language: 'fbd',
      nodeId: 'BLOCK-1',
      instanceName: 'ES_GEN_WELD2',
      blockName: 'ES_GEN_WELD',
    })
    expect(outdatedBlocks[0].changes.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: 'USON_STATE', kind: 'changed' },
      { name: 'POWER', kind: 'added' },
    ])
  })

  it('accepts an instance that already uses the current interface', () => {
    expect(findOutdatedLibraryBlocks(buildProject(currentWeldBlock), libraries)).toEqual([])
  })
})
