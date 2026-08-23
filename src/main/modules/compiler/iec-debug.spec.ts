import { createHash } from 'node:crypto'

import type { ProjectState } from '@root/renderer/store/slices'

import {
  bindIecDebugVariablesToInstances,
  buildGraphicalDebugBindings,
  enrichIecDebugMetadata,
  fnv1a32,
  IEC_DEBUG_VARIABLE_ADAPTER_MARKER,
  IecDebugVariableType,
  parseIecDebugInstances,
  parseIecDebugVariables,
  parseXml2stSourceMap,
  prepareProjectForIecDebug,
  renderIecDebugVariableAdapter,
  type Xml2stSourceMap,
} from './iec-debug'

describe('IEC debug build helpers', () => {
  const span = (line: number, column: number, length: number, offset = 0) => ({
    start: { line, column, offset },
    end: { line, column: column + length, offset: offset + length },
  })

  const sourceMap = (chunks: Xml2stSourceMap['chunks']): Xml2stSourceMap => ({
    format: 'eurosonic-xml2st-source-map',
    version: 1,
    project_sha256: 'project',
    st_sha256: 'st',
    st_length: 0,
    chunks,
  })

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

  it('maps program and nested FB instances to stable IDs and generated C addresses', () => {
    const csv = `
// Programs
0;CONFIG0.RES0.INSTANCE0;MAIN;

// Variables
0;FB;CONFIG0.RES0.INSTANCE0;CONFIG0.RES0.INSTANCE0;MAIN;;0;
1;FB;CONFIG0.RES0.INSTANCE0.PUMP1;CONFIG0.RES0.INSTANCE0.PUMP1;FB_PUMP;;0;
2;VAR;CONFIG0.RES0.INSTANCE0.PUMP1.COUNTER;CONFIG0.RES0.INSTANCE0.PUMP1.COUNTER;DINT;DINT;0;
3;FB;CONFIG0.RES0.INSTANCE0.PUMP2;CONFIG0.RES0.INSTANCE0.PUMP2;FB_PUMP;;0;
4;VAR;CONFIG0.RES0.INSTANCE0.PUMP2.COUNTER;CONFIG0.RES0.INSTANCE0.PUMP2.COUNTER;DINT;DINT;0;
5;VAR;CONFIG0.RES0.INSTANCE0.VALUES.value.table[0];CONFIG0.RES0.INSTANCE0.VALUES.value.table[0];DINT;DINT;0;
6;STRUCT;CONFIG0.RES0.INSTANCE0.CONFIG;CONFIG0.RES0.INSTANCE0.CONFIG;PUMP_CONFIG;;0;
7;VAR;CONFIG0.RES0.INSTANCE0.CONFIG.LIMIT;CONFIG0.RES0.INSTANCE0.CONFIG.LIMIT;DINT;DINT;0;
8;FB;CONFIG0.RES0.INSTANCE0.GROUP1;CONFIG0.RES0.INSTANCE0.GROUP1;FB_GROUP;;0;
9;FB;CONFIG0.RES0.INSTANCE0.GROUP1.PUMP;CONFIG0.RES0.INSTANCE0.GROUP1.PUMP;FB_PUMP;;0;
10;VAR;CONFIG0.RES0.INSTANCE0.GROUP1.PUMP.COUNTER;CONFIG0.RES0.INSTANCE0.GROUP1.PUMP.COUNTER;DINT;DINT;0;
`
    const pous = [
      { id: 10, key: 'pou-v1:program:MAIN', name: 'MAIN', kind: 'program' },
      { id: 20, key: 'pou-v1:function_block:FB_PUMP', name: 'FB_PUMP', kind: 'function_block' },
      { id: 30, key: 'pou-v1:function_block:FB_GROUP', name: 'FB_GROUP', kind: 'function_block' },
    ]
    const instances = parseIecDebugInstances(csv, pous)
    const variables = bindIecDebugVariablesToInstances(parseIecDebugVariables(csv), instances)
    const pump1 = instances.find((instance) => instance.path === 'MAIN.PUMP1')
    const pump2 = instances.find((instance) => instance.path === 'MAIN.PUMP2')
    const group = instances.find((instance) => instance.path === 'MAIN.GROUP1')
    const nestedPump = instances.find((instance) => instance.path === 'MAIN.GROUP1.PUMP')
    const adapter = renderIecDebugVariableAdapter(variables, instances)

    expect(instances).toHaveLength(5)
    expect(pump1?.id).not.toBe(pump2?.id)
    expect(pump1).toMatchObject({ pou_id: 20, c_expression: 'RES0__INSTANCE0.PUMP1' })
    expect(variables.find((variable) => variable.path === 'MAIN.PUMP2.COUNTER')?.instance_id).toBe(pump2?.id)
    expect(variables.find((variable) => variable.path === 'MAIN.VALUES[0]')?.legacy_index).toBe(2)
    expect(variables.find((variable) => variable.path === 'MAIN.CONFIG.LIMIT')?.legacy_index).toBe(3)
    expect(nestedPump).toMatchObject({ pou_id: 20, parent_id: group?.id })
    expect(variables.find((variable) => variable.path === 'MAIN.GROUP1.PUMP.COUNTER')?.instance_id).toBe(nestedPump?.id)
    expect(adapter).toContain('extern MAIN RES0__INSTANCE0;')
    expect(adapter).toContain('(uintptr_t)&(RES0__INSTANCE0.PUMP1)')
    expect(adapter).toContain('plc_debug_instance_resolve')
  })

  it('maps FBD blocks and outputs to generated statement IDs without target-side data', () => {
    const project = {
      pous: [
        {
          type: 'program',
          data: {
            name: 'fbdtest',
            body: {
              language: 'fbd',
              value: {
                name: 'fbdtest',
                rung: {
                  nodes: [
                    {
                      id: 'add-node',
                      type: 'block',
                      position: { x: 200, y: 0 },
                      data: {
                        numericId: '3168552',
                        variant: {
                          name: 'ADD',
                          type: 'function',
                          variables: [
                            { name: 'IN1', class: 'input' },
                            { name: 'IN2', class: 'input' },
                            { name: 'OUT', class: 'output' },
                          ],
                        },
                      },
                    },
                    {
                      id: 'sum-node',
                      type: 'output-variable',
                      position: { x: 400, y: 0 },
                      data: { numericId: '400', variable: { name: 'SumValue' } },
                    },
                    {
                      id: 'gt-node',
                      type: 'block',
                      position: { x: 200, y: 100 },
                      data: { numericId: '8597144', variant: { name: 'GT', type: 'function' } },
                    },
                    {
                      id: 'result-node',
                      type: 'output-variable',
                      position: { x: 400, y: 100 },
                      data: { numericId: '401', variable: { name: 'Result' } },
                    },
                  ],
                  edges: [],
                },
              },
            },
          },
        },
      ],
    } as unknown as ProjectState['data']
    const metadata = {
      pous: [{ id: 10, key: 'pou-v1:program:FBDTEST', name: 'FBDTEST', kind: 'program' }],
      statements: [
        {
          id: 20,
          pou_id: 10,
          key: 'add-assign',
          file: 'program.st',
          line: 2,
          column: 1,
          end_line: 2,
          end_column: 45,
          type: 'assignment',
        },
        {
          id: 21,
          pou_id: 10,
          key: 'add-call',
          file: 'program.st',
          line: 2,
          column: 24,
          end_line: 2,
          end_column: 44,
          type: 'function_call',
        },
        {
          id: 22,
          pou_id: 10,
          key: 'sum-assign',
          file: 'program.st',
          line: 3,
          column: 1,
          end_line: 3,
          end_column: 34,
          type: 'assignment',
        },
        {
          id: 23,
          pou_id: 10,
          key: 'gt-assign',
          file: 'program.st',
          line: 4,
          column: 1,
          end_line: 4,
          end_column: 66,
          type: 'assignment',
        },
        {
          id: 24,
          pou_id: 10,
          key: 'gt-call',
          file: 'program.st',
          line: 4,
          column: 23,
          end_line: 4,
          end_column: 65,
          type: 'function_call',
        },
        {
          id: 25,
          pou_id: 10,
          key: 'result-assign',
          file: 'program.st',
          line: 5,
          column: 1,
          end_line: 5,
          end_column: 35,
          type: 'assignment',
        },
      ],
    }

    const map = sourceMap([
      {
        metadata: ['P::fbdtest', 'block', 3168552, 'output', 0],
        graphical: { pou: 'fbdtest', kind: 'block', local_id: 3168552, path: ['output', 0] },
        text: '_TMP_ADD3168552_OUT',
        quality: 'exact',
        span: span(2, 1, 19),
      },
      {
        metadata: ['P::fbdtest', 'block', 3168552, 'type'],
        graphical: { pou: 'fbdtest', kind: 'block', local_id: 3168552, path: ['type'] },
        text: 'ADD',
        quality: 'exact',
        span: span(2, 24, 3),
      },
      {
        metadata: ['P::fbdtest', 'block', 3168552, 'input', 0],
        graphical: { pou: 'fbdtest', kind: 'block', local_id: 3168552, path: ['input', 0] },
        text: 'ValueA',
        quality: 'exact',
        span: span(2, 28, 6),
      },
      {
        metadata: ['P::fbdtest', 'block', 3168552, 'input', 1],
        graphical: { pou: 'fbdtest', kind: 'block', local_id: 3168552, path: ['input', 1] },
        text: 'ValueB',
        quality: 'exact',
        span: span(2, 36, 6),
      },
      {
        metadata: ['P::fbdtest', 'io_variable', 400, 'expression'],
        graphical: { pou: 'fbdtest', kind: 'io_variable', local_id: 400, path: ['expression'] },
        text: 'SumValue',
        quality: 'exact',
        span: span(3, 1, 8),
      },
      {
        metadata: ['P::fbdtest', 'block', 8597144, 'type'],
        graphical: { pou: 'fbdtest', kind: 'block', local_id: 8597144, path: ['type'] },
        text: 'GT',
        quality: 'exact',
        span: span(4, 23, 2),
      },
      {
        metadata: ['P::fbdtest', 'io_variable', 401, 'expression'],
        graphical: { pou: 'fbdtest', kind: 'io_variable', local_id: 401, path: ['expression'] },
        text: 'Result',
        quality: 'exact',
        span: span(5, 1, 6),
      },
    ])

    expect(buildGraphicalDebugBindings(project, metadata, map)).toEqual([
      expect.objectContaining({
        node_id: 'add-node',
        statement_ids: [20, 21],
        breakpoint_statement_id: 21,
        pins: [
          expect.objectContaining({ direction: 'output', formal_parameter: 'OUT', pin_index: 0 }),
          expect.objectContaining({ direction: 'input', formal_parameter: 'IN1', pin_index: 0 }),
          expect.objectContaining({ direction: 'input', formal_parameter: 'IN2', pin_index: 1 }),
        ],
      }),
      expect.objectContaining({ node_id: 'sum-node', statement_ids: [22], breakpoint_statement_id: 22 }),
      expect.objectContaining({ node_id: 'gt-node', statement_ids: [23, 24], breakpoint_statement_id: 24 }),
      expect.objectContaining({ node_id: 'result-node', statement_ids: [25], breakpoint_statement_id: 25 }),
    ])
  })

  it('maps LD block calls and coils in rung order', () => {
    const project = {
      pous: [
        {
          type: 'program',
          data: {
            name: 'main',
            body: {
              language: 'ld',
              value: {
                name: 'main',
                rungs: [
                  {
                    id: 'rung-1',
                    nodes: [
                      {
                        id: 'ton-node',
                        type: 'block',
                        position: { x: 100, y: 0 },
                        data: {
                          numericId: '100',
                          variable: { name: 'TON0' },
                          variant: { name: 'TON', type: 'function-block' },
                        },
                      },
                      {
                        id: 'coil-node',
                        type: 'coil',
                        position: { x: 300, y: 0 },
                        data: { numericId: '300', variable: { name: 'blink_led' } },
                      },
                    ],
                    edges: [],
                  },
                ],
              },
            },
          },
        },
      ],
    } as unknown as ProjectState['data']
    const metadata = {
      pous: [{ id: 30, key: 'pou-v1:program:MAIN', name: 'MAIN', kind: 'program' }],
      statements: [
        {
          id: 31,
          pou_id: 30,
          key: 'ton-call',
          file: 'program.st',
          line: 2,
          column: 1,
          end_line: 2,
          end_column: 35,
          type: 'function_block_call',
        },
        {
          id: 32,
          pou_id: 30,
          key: 'coil-assign',
          file: 'program.st',
          line: 3,
          column: 1,
          end_line: 3,
          end_column: 21,
          type: 'assignment',
        },
      ],
    }

    const map = sourceMap([
      {
        metadata: ['P::main', 'block', 100, 'name'],
        graphical: { pou: 'main', kind: 'block', local_id: 100, path: ['name'] },
        text: 'TON0',
        quality: 'exact',
        span: span(2, 1, 4),
      },
      {
        metadata: ['P::main', 'coil', 300, 'reference'],
        graphical: { pou: 'main', kind: 'coil', local_id: 300, path: ['reference'] },
        text: 'blink_led',
        quality: 'exact',
        span: span(3, 1, 9),
      },
    ])

    expect(buildGraphicalDebugBindings(project, metadata, map)).toEqual([
      expect.objectContaining({ node_id: 'ton-node', rung_id: 'rung-1', breakpoint_statement_id: 31 }),
      expect.objectContaining({ node_id: 'coil-node', rung_id: 'rung-1', breakpoint_statement_id: 32 }),
    ])
  })

  it('scopes reused localIds to the owning POU and keeps a formal-name fallback for input pins', () => {
    const makePou = (name: string, nodeId: string) => ({
      type: 'program',
      data: {
        name,
        body: {
          language: 'fbd',
          value: {
            name,
            rung: {
              nodes: [
                {
                  id: nodeId,
                  type: 'block',
                  position: { x: 0, y: 0 },
                  data: { numericId: '42', variant: { name: 'CUSTOM', type: 'function', variables: [] } },
                },
              ],
              edges: [],
            },
          },
        },
      },
    })
    const project = {
      pous: [makePou('First', 'first-node'), makePou('Second', 'second-node')],
    } as unknown as ProjectState['data']
    const metadata = {
      pous: [
        { id: 1, key: 'first', name: 'FIRST', kind: 'program' },
        { id: 2, key: 'second', name: 'SECOND', kind: 'program' },
      ],
      statements: [
        {
          id: 11,
          pou_id: 1,
          key: 's1',
          file: 'program.st',
          line: 10,
          column: 1,
          end_line: 10,
          end_column: 20,
          type: 'function_call',
        },
        {
          id: 22,
          pou_id: 2,
          key: 's2',
          file: 'program.st',
          line: 20,
          column: 1,
          end_line: 20,
          end_column: 20,
          type: 'function_call',
        },
      ],
    }
    const map = sourceMap([
      {
        metadata: ['P::First', 'block', 42, 'input', 0],
        graphical: { pou: 'First', kind: 'block', local_id: 42, path: ['input', 0] },
        text: 'ENABLE',
        quality: 'exact',
        span: span(10, 2, 6),
      },
      {
        metadata: ['P::Second', 'block', 42, 'type'],
        graphical: { pou: 'Second', kind: 'block', local_id: 42, path: ['type'] },
        text: 'CUSTOM',
        quality: 'exact',
        span: span(20, 2, 6),
      },
    ])

    expect(buildGraphicalDebugBindings(project, metadata, map)).toEqual([
      expect.objectContaining({
        pou_id: 1,
        node_id: 'first-node',
        breakpoint_statement_id: 11,
        pins: [expect.objectContaining({ direction: 'input', formal_parameter: 'ENABLE', pin_index: 0 })],
      }),
      expect.objectContaining({ pou_id: 2, node_id: 'second-node', breakpoint_statement_id: 22 }),
    ])
  })

  it('validates project, final ST and every exact xml2st source span', () => {
    const projectXml = '<project />'
    const programSt = 'PROGRAM MAIN\n  Value := 1;\nEND_PROGRAM\n'
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    const map = {
      format: 'eurosonic-xml2st-source-map',
      version: 1,
      project_sha256: hash(projectXml),
      st_sha256: hash(programSt),
      st_length: programSt.length,
      chunks: [
        {
          metadata: ['P::MAIN', 'io_variable', 1, 'expression'],
          graphical: { pou: 'MAIN', kind: 'io_variable', local_id: 1, path: ['expression'] },
          text: 'Value',
          quality: 'exact',
          span: {
            start: { line: 2, column: 3, offset: 15 },
            end: { line: 2, column: 8, offset: 20 },
          },
        },
      ],
    }

    expect(
      parseXml2stSourceMap(JSON.stringify(map), projectXml, `${programSt}\n(*DBG:appended after MatIEC*)`),
    ).toMatchObject({
      version: 1,
    })
    expect(() => parseXml2stSourceMap(JSON.stringify({ ...map, st_sha256: 'bad' }), projectXml, programSt)).toThrow(
      'ST hash mismatch',
    )
    expect(() => parseXml2stSourceMap(JSON.stringify(map), '<different />', programSt)).toThrow('project hash mismatch')
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
        instance_id: 0,
        path: 'MAIN.COUNTER',
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
