import { PLCConfiguration } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/old-editor'
import { PouInstance, TaskXML } from '@root/types/PLC/xml-data/old-editor/task/task-diagram'
import { VariableXML } from '@root/types/PLC/xml-data/old-editor/variable/variable-diagram'

import { convertTypeToXml } from './type-xml'

export const oldEditorInstanceToXml = (xml: BaseXml, configuration: PLCConfiguration) => {
  const { instances, tasks, globalVariables } = configuration.resource

  tasks.forEach((task) => {
    const i: PouInstance[] =
      instances
        .filter((i) => i.task === task.name)
        .map((i) => {
          return {
            '@name': i.name,
            '@typeName': i.program,
          }
        }) || []

    const t: TaskXML = {
      '@name': task.name,
      '@priority': task.priority.toString(),
      '@interval': task.triggering === 'Cyclic' ? task.interval.toString() : null,
      '@single': task.triggering === 'Interrupt' ? '' : null,
      pouInstance: i,
    }

    if (!xml.project.instances.configurations.configuration.resource.task) {
      xml.project.instances.configurations.configuration.resource.task = []
    }
    xml.project.instances.configurations.configuration.resource.task.push(t)
  })

  const groups: Array<{ variable: VariableXML[]; '@retain'?: 'true' }> = []
  globalVariables.forEach((variable) => {
    const v: VariableXML = {
      '@name': variable.name,
      '@address': variable.location || undefined,
      type: convertTypeToXml(variable.type),
      initialValue: variable.initialValue
        ? {
            simpleValue: {
              '@value': variable.initialValue,
            },
          }
        : null,
      documentation: {
        'xhtml:p': {
          $: variable.documentation === '' ? ' ' : variable.documentation,
        },
      },
    }

    // Bundled MatIEC drops RETAIN after the first global declaration in a block.
    // Emit each retained global in its own block; keep ordinary globals grouped.
    let group = variable.retain ? undefined : groups.find((item) => !item['@retain'])
    if (!group) {
      group = { variable: [], ...(variable.retain ? { '@retain': 'true' as const } : {}) }
      groups.push(group)
    }
    group.variable.push(v)
  })

  if (groups.length)
    xml.project.instances.configurations.configuration.globalVars = groups.length === 1 ? groups[0] : groups
  return xml
}
