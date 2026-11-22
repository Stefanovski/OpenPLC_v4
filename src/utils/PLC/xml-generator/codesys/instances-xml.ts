import { PLCConfiguration } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/codesys'
import { PouInstance, TaskXML } from '@root/types/PLC/xml-data/codesys/task/task-diagram'
import type { VariableXML } from '@root/types/PLC/xml-data/codesys/variable/variable-diagram'

export const codeSysInstanceToXml = (xml: BaseXml, configuration: PLCConfiguration) => {
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
    const v = {
      '@name': variable.name,
      '@address': variable.location,
      type: {
        [variable.type.value.toUpperCase()]: '',
      },
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

    let group = groups.find((item) => Boolean(item['@retain']) === Boolean(variable.retain))
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
