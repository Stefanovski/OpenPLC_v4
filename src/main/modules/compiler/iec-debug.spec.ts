import type { ProjectState } from '@root/renderer/store/slices'

import {
  enrichIecDebugMetadata,
  fnv1a32,
  IEC_DEBUG_VARIABLE_ADAPTER_MARKER,
  IecDebugVariableType,
  parseIecDebugVariables,
  prepareProjectForIecDebug,
  renderIecDebugVariableAdapter,
} from './iec-debug'

describe('IEC debug build helpers', () => {
  it('uses the specified UTF-8 FNV-1a 32-bit algorithm', () => {
    expect(fnv1a32('hello')).toBe(0x4f9f2cab)
  })

  it('creates body-local ST files without modifying the production project', () => {
    const project = {
      pous: [
        { data: { name: 'MAIN', body: { language: 'st', value: 'Counter := Counter + 1;' } } },
        { data: { name: 'GRAPH', body: { language: 'ld', value: [] } } },
      ],
    } as unknown as ProjectState['data']

    const prepared = prepareProjectForIecDebug(project)

    expect(prepared.sourceFiles).toEqual([{ fileName: 'main.st', content: 'Counter := Counter + 1;\n' }])
    expect(prepared.projectData.pous[0].data.body).toEqual({ language: 'st', value: '{#include "main.st"}' })
    expect(project.pous[0].data.body).toEqual({ language: 'st', value: 'Counter := Counter + 1;' })
  })

  it('assigns stable IDs while preserving the compact legacy debug index', () => {
    const variables = parseIecDebugVariables(`
// Variables
0;FB;CONFIG0.RES0.INSTANCE0;CONFIG0.RES0.INSTANCE0;MAIN;;0;
1;VAR;CONFIG0.RES0.INSTANCE0.COUNTER;CONFIG0.RES0.INSTANCE0.COUNTER;DINT;DINT;0;
2;OUT;CONFIG0.RES0.INSTANCE0.OUTPUT;CONFIG0.RES0.INSTANCE0.OUTPUT;BOOL;BOOL;0;
`)

    expect(variables).toHaveLength(2)
    expect(variables.map((variable) => variable.legacy_index).sort()).toEqual([0, 1])
    expect(variables.find((variable) => variable.name.endsWith('COUNTER'))).toMatchObject({
      type_code: IecDebugVariableType.Dint,
      writable: true,
    })
    expect(variables.find((variable) => variable.name.endsWith('OUTPUT'))).toMatchObject({
      type_code: IecDebugVariableType.Bool,
      writable: true,
    })
  })

  it('enriches versioned metadata and emits a sorted embedded adapter', () => {
    const variables = parseIecDebugVariables(
      '1;VAR;CONFIG0.RES0.INSTANCE0.COUNTER;CONFIG0.RES0.INSTANCE0.COUNTER;DINT;DINT;0;\n',
    )
    const metadata = JSON.stringify({
      format: 'eurosonic-plc-debug',
      version: 1,
      id_algorithm: 'fnv1a32',
      build_id: 'old',
      pous: [{ id: 10, key: 'pou-v1:program:MAIN', name: 'MAIN', kind: 'program' }],
      statements: [
        {
          id: 20,
          pou_id: 10,
          key: 'stmt-v1:10:main.st:1:1:1:10:assignment',
          file: 'main.st',
          line: 1,
          column: 1,
          end_line: 1,
          end_column: 10,
          type: 'assignment',
        },
      ],
      variables: [],
      instances: [],
    })

    const enriched = JSON.parse(enrichIecDebugMetadata(metadata, variables)) as {
      build_id: string
      variables: unknown[]
    }
    const adapter = renderIecDebugVariableAdapter(variables)

    expect(enriched.build_id).toMatch(/^[0-9a-f]{16}$/)
    expect(enriched.variables).toHaveLength(1)
    expect(adapter).toContain(IEC_DEBUG_VARIABLE_ADAPTER_MARKER)
    expect(adapter).toContain(`UINT32_C(${variables[0].id})`)
    expect(adapter).toContain('plc_debug_variable_write')
    expect(adapter).toContain('plc_debug_variable_force')
  })

  it('rejects a stable-ID collision across metadata categories', () => {
    const variables = [
      {
        id: 10,
        key: 'var-v1:MAIN.COUNTER:DINT',
        name: 'MAIN.COUNTER',
        type: 'DINT',
        type_code: IecDebugVariableType.Dint,
        legacy_index: 0,
        writable: true,
      },
    ]
    const metadata = JSON.stringify({
      format: 'eurosonic-plc-debug',
      version: 1,
      id_algorithm: 'fnv1a32',
      build_id: 'old',
      pous: [{ id: 10, key: 'pou-v1:program:MAIN', name: 'MAIN', kind: 'program' }],
      statements: [],
      variables: [],
      instances: [],
    })

    expect(() => enrichIecDebugMetadata(metadata, variables)).toThrow('IEC debug ID collision')
  })
})
