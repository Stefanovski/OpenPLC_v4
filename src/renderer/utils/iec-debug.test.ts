import type { IecDebugMetadata, IecDebugVariable } from '@root/types/PLC/iec-debug'

import {
  buildFbDebugInstanceMap,
  buildIecDebugBreakpoint,
  encodeIecDebugLiteral,
  formatIecDebugValue,
  iecDebugValueSize,
  resolveIecDebugInstance,
} from './iec-debug'

const variable = (type_code: number, type = 'DINT'): IecDebugVariable => ({
  id: 11,
  key: 'counter',
  name: 'Counter',
  type,
  type_code,
  legacy_index: 0,
  writable: true,
  instance_id: 7,
  path: 'MAIN.PUMP1.Counter',
})

const metadata: IecDebugMetadata = {
  format: 'eurosonic-plc-debug',
  version: 1,
  id_algorithm: 'fnv1a32',
  build_id: 'build',
  pous: [{ id: 2, key: 'pou', name: 'FB_COUNTER', kind: 'function-block' }],
  statements: [
    {
      id: 3,
      pou_id: 2,
      key: 'statement',
      file: 'fb_counter.st',
      line: 4,
      column: 1,
      end_line: 4,
      end_column: 5,
      type: 'assignment',
    },
  ],
  instances: [
    {
      id: 7,
      key: 'instance',
      name: 'PUMP1',
      path: 'MAIN.PUMP1',
      source_path: 'MAIN.PUMP1',
      pou_id: 2,
      parent_id: 0,
      kind: 'function-block',
    },
  ],
  variables: [variable(6)],
}

describe('IEC debugger utilities', () => {
  it('reports target value sizes and formats primitive values', () => {
    expect(iecDebugValueSize(1)).toBe(1)
    expect(iecDebugValueSize(4)).toBe(2)
    expect(iecDebugValueSize(10)).toBe(4)
    expect(iecDebugValueSize(8)).toBe(8)
    expect(iecDebugValueSize(16)).toBe(127)
    expect(iecDebugValueSize(99)).toBe(0)
    expect(formatIecDebugValue(variable(1, 'BOOL'), [1])).toBe('TRUE')
    expect(formatIecDebugValue(variable(2, 'SINT'), [0xff])).toBe('-1')
    expect(formatIecDebugValue(variable(3, 'USINT'), [0xff])).toBe('255')
    expect(formatIecDebugValue(variable(17, 'BYTE'), [0xff])).toBe('255')
    expect(formatIecDebugValue(variable(4, 'INT'), [0xff, 0xff])).toBe('-1')
    expect(formatIecDebugValue(variable(5, 'UINT'), [0xff, 0xff])).toBe('65535')
    expect(formatIecDebugValue(variable(18, 'WORD'), [0xff, 0xff])).toBe('65535')
    expect(formatIecDebugValue(variable(6), [42, 0, 0, 0])).toBe('42')
    expect(formatIecDebugValue(variable(7, 'UDINT'), [0xff, 0xff, 0xff, 0xff])).toBe('4294967295')
    expect(formatIecDebugValue(variable(19, 'DWORD'), [0xff, 0xff, 0xff, 0xff])).toBe('4294967295')
    expect(formatIecDebugValue(variable(8, 'LINT'), [1, 0, 0, 0, 0, 0, 0, 0])).toBe('1')
    expect(formatIecDebugValue(variable(9, 'ULINT'), [1, 0, 0, 0, 0, 0, 0, 0])).toBe('1')
    expect(formatIecDebugValue(variable(20, 'LWORD'), [1, 0, 0, 0, 0, 0, 0, 0])).toBe('1')
    expect(formatIecDebugValue(variable(10, 'REAL'), [0, 0, 0x80, 0x3f])).toBe('1')
    expect(formatIecDebugValue(variable(11, 'LREAL'), [0, 0, 0, 0, 0, 0, 0xf0, 0x3f])).toBe('1')
    expect(formatIecDebugValue(variable(99, 'UNKNOWN'), [0xab])).toBe('0xab')
  })

  it('encodes supported condition literals without throwing on invalid ranges', () => {
    expect(encodeIecDebugLiteral(variable(1, 'BOOL'), 'TRUE')).toEqual([1])
    expect(encodeIecDebugLiteral(variable(1, 'BOOL'), 'invalid')).toBeNull()
    expect(encodeIecDebugLiteral(variable(2, 'SINT'), '-1')).toEqual([0xff])
    expect(encodeIecDebugLiteral(variable(3, 'USINT'), '255')).toEqual([0xff])
    expect(encodeIecDebugLiteral(variable(4, 'INT'), '-1')).toEqual([0xff, 0xff])
    expect(encodeIecDebugLiteral(variable(5, 'UINT'), '65535')).toEqual([0xff, 0xff])
    expect(encodeIecDebugLiteral(variable(6), '42')).toEqual([42, 0, 0, 0])
    expect(encodeIecDebugLiteral(variable(7, 'UDINT'), '4294967295')).toEqual([0xff, 0xff, 0xff, 0xff])
    expect(encodeIecDebugLiteral(variable(17, 'BYTE'), '255')).toEqual([0xff])
    expect(encodeIecDebugLiteral(variable(18, 'WORD'), '65535')).toEqual([0xff, 0xff])
    expect(encodeIecDebugLiteral(variable(19, 'DWORD'), '4294967295')).toEqual([0xff, 0xff, 0xff, 0xff])
    expect(encodeIecDebugLiteral(variable(17, 'BYTE'), '1.5')).toBeNull()
    expect(encodeIecDebugLiteral(variable(17, 'BYTE'), '256')).toBeNull()
    expect(encodeIecDebugLiteral(variable(8, 'LINT'), '-1')).toEqual(new Array(8).fill(0xff))
    expect(encodeIecDebugLiteral(variable(8, 'LINT'), '9223372036854775808')).toBeNull()
    expect(encodeIecDebugLiteral(variable(9, 'ULINT'), '1')).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(encodeIecDebugLiteral(variable(20, 'LWORD'), '1')).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(encodeIecDebugLiteral(variable(10, 'REAL'), '1')).toEqual([0, 0, 0x80, 0x3f])
    expect(encodeIecDebugLiteral(variable(11, 'LREAL'), '1')).toEqual([0, 0, 0, 0, 0, 0, 0xf0, 0x3f])
    expect(encodeIecDebugLiteral(variable(2, 'SINT'), '1000')).toBeNull()
    expect(encodeIecDebugLiteral(variable(8, 'LINT'), 'invalid')).toBeNull()
    expect(encodeIecDebugLiteral(variable(9, 'ULINT'), '-1')).toBeNull()
    expect(encodeIecDebugLiteral(variable(10, 'REAL'), 'Infinity')).toBeNull()
    expect(encodeIecDebugLiteral(variable(11, 'LREAL'), 'NaN')).toBeNull()
    expect(encodeIecDebugLiteral(variable(12, 'TIME'), '1')).toBeNull()
    expect(encodeIecDebugLiteral(variable(16, 'STRING'), 'text')).toBeNull()
    expect(encodeIecDebugLiteral(variable(99, 'UNKNOWN'), '1')).toBeNull()
  })

  it('builds instance, condition, change and hit-count breakpoints', () => {
    expect(
      buildIecDebugBreakpoint(
        { metadata, statement: metadata.statements[0], currentInstance: metadata.instances[0] },
        'instance=current; Counter>=10; change=Counter; hit=500',
      ),
    ).toEqual({
      statementId: 3,
      instanceId: 7,
      condition: { variableId: 11, type: 6, operator: '>=', value: [10, 0, 0, 0] },
      change: { variableId: 11, type: 6, size: 4 },
      hitTarget: 500,
    })
  })

  it('resolves the selected nested FB instance independently from the graphical POU definition', () => {
    const second = { ...metadata.instances[0], id: 8, path: 'MAIN.LINE1.PUMP2', key: 'instance-2' }
    const nestedMetadata = { ...metadata, instances: [...metadata.instances, second] }
    expect(resolveIecDebugInstance(nestedMetadata, 'FB_COUNTER', 7, 'main.line1.pump2')?.id).toBe(8)
    expect(resolveIecDebugInstance(nestedMetadata, 'FB_COUNTER', 7)?.id).toBe(7)
    expect(resolveIecDebugInstance(nestedMetadata, 'FB_COUNTER')?.id).toBe(7)
    expect(resolveIecDebugInstance(null, 'FB_COUNTER')).toBeUndefined()
    expect(resolveIecDebugInstance(nestedMetadata, 'MISSING', 7)).toBeUndefined()
  })

  it('builds a deterministic selector model for nested instances without duplicating the POU graph', () => {
    const nested = {
      ...metadata.instances[0],
      id: 8,
      path: 'MAIN.LINE1.PUMP2',
      source_path: 'CONFIG0.RES0.MAIN.LINE1.PUMP2',
      key: 'nested',
    }
    const instanceMap = buildFbDebugInstanceMap({ ...metadata, instances: [nested, metadata.instances[0]] })
    expect(instanceMap.get('FB_COUNTER')).toEqual([
      expect.objectContaining({ key: 'MAIN:LINE1.PUMP2', path: 'MAIN.LINE1.PUMP2', instanceId: 8 }),
      expect.objectContaining({ key: 'MAIN:PUMP1', path: 'MAIN.PUMP1', instanceId: 7 }),
    ])

    expect(
      buildFbDebugInstanceMap({
        ...metadata,
        instances: [
          { ...metadata.instances[0], id: 9, kind: 'program' },
          { ...metadata.instances[0], id: 10, pou_id: 999 },
          { ...metadata.instances[0], id: 11, path: 'MAIN' },
          metadata.instances[0],
        ],
      }).get('FB_COUNTER'),
    ).toEqual([expect.objectContaining({ instanceId: 7 })])
  })

  it('rejects ambiguous or invalid advanced breakpoint specifications', () => {
    expect(() => buildIecDebugBreakpoint({ metadata, statement: metadata.statements[0] }, 'Counter=10')).toThrow(
      "Unknown breakpoint option 'Counter=10'",
    )
    expect(() => buildIecDebugBreakpoint({ metadata, statement: metadata.statements[0] }, 'hit=0')).toThrow(
      'Hit count must be a positive integer',
    )
    expect(() => buildIecDebugBreakpoint({ metadata, statement: metadata.statements[0] }, 'Counter>=10')).toThrow(
      'requires an explicit instance',
    )
    expect(() => buildIecDebugBreakpoint({ metadata, statement: metadata.statements[0] }, 'change=Counter')).toThrow(
      'requires an explicit instance',
    )
    expect(() =>
      buildIecDebugBreakpoint({ metadata, statement: metadata.statements[0] }, 'instance=MAIN.MISSING'),
    ).toThrow("Unknown FB_COUNTER instance 'MAIN.MISSING'")
    expect(() =>
      buildIecDebugBreakpoint(
        { metadata, statement: metadata.statements[0], currentInstance: metadata.instances[0] },
        'instance=current; change=Missing',
      ),
    ).toThrow("Unknown local IEC variable 'MISSING'")
    expect(() =>
      buildIecDebugBreakpoint(
        {
          metadata: { ...metadata, variables: [variable(16, 'STRING')] },
          statement: metadata.statements[0],
          currentInstance: metadata.instances[0],
        },
        'instance=current; change=Counter',
      ),
    ).toThrow('does not support STRING')
    expect(() =>
      buildIecDebugBreakpoint(
        { metadata, statement: metadata.statements[0], currentInstance: metadata.instances[0] },
        'instance=current; Missing>=10',
      ),
    ).toThrow("Unknown local IEC variable 'Missing'")
    expect(() =>
      buildIecDebugBreakpoint(
        { metadata, statement: metadata.statements[0], currentInstance: metadata.instances[0] },
        'instance=current; Counter>=invalid',
      ),
    ).toThrow('Conditions do not support DINT')
  })
})
