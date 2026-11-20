import type { PrintTable } from '@root/types/IPC/print'
import type { PLCDataType, PLCVariable } from '@root/types/PLC/open-plc'

import type { RootState } from '../store'

export function printType(type: PLCVariable['type']): string {
  if (type.definition === 'array')
    return `ARRAY [${type.data.dimensions.map((d) => d.dimension).join(', ')}] OF ${printType(type.data.baseType)}`
  return type.definition === 'base-type' ? type.value.toUpperCase() : type.value
}

export function buildConfigurationTables(
  resource: RootState['project']['data']['configuration']['resource'],
  dataTypes: PLCDataType[],
  pendingGlobals: boolean,
): PrintTable[] {
  const tables: PrintTable[] = []
  if (!pendingGlobals)
    tables.push({
      title: 'Global variables',
      columns: ['Name', 'Type', 'Location', 'Initial value', 'Retain', 'Documentation'],
      widths: [0.17, 0.22, 0.13, 0.14, 0.08, 0.26],
      rows: resource.globalVariables.map((v) => [
        v.name,
        printType(v.type),
        v.location,
        v.initialValue ?? '',
        v.retain ? 'Yes' : '',
        v.documentation,
      ]),
    })
  tables.push(
    {
      title: 'Tasks',
      columns: ['Name', 'Trigger', 'Interval / event', 'Priority'],
      widths: [0.3, 0.2, 0.35, 0.15],
      rows: resource.tasks.map((t) => [t.name, t.triggering, t.interval, String(t.priority)]),
    },
    {
      title: 'Program instances',
      columns: ['Instance', 'Task', 'Program'],
      widths: [0.35, 0.3, 0.35],
      rows: resource.instances.map((i) => [i.name, i.task, i.program]),
    },
  )
  if (!dataTypes.length)
    tables.push({ title: 'Data types', columns: ['Name', 'Definition'], widths: [0.3, 0.7], rows: [] })
  for (const type of dataTypes) {
    if (type.derivation === 'structure')
      tables.push({
        title: `Data type: ${type.name} (STRUCT)`,
        columns: ['Member', 'Type', 'Initial value'],
        widths: [0.3, 0.5, 0.2],
        rows: type.variable.map((v) => [v.name, printType(v.type), v.initialValue?.simpleValue.value ?? '']),
      })
    else if (type.derivation === 'array')
      tables.push({
        title: `Data type: ${type.name} (ARRAY)`,
        columns: ['Dimensions', 'Element type', 'Initial value'],
        widths: [0.35, 0.35, 0.3],
        rows: [[type.dimensions.map((d) => d.dimension).join(', '), printType(type.baseType), type.initialValue ?? '']],
      })
    else
      tables.push({
        title: `Data type: ${type.name} (ENUM)`,
        columns: ['Values', 'Initial value'],
        widths: [0.75, 0.25],
        rows: [[type.values.map((v) => v.description).join(', '), type.initialValue ?? '']],
      })
  }
  return tables
}
