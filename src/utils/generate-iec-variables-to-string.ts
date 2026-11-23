import { PLCVariable } from '@root/types/PLC'
import type { PLCVariable as LegacyPLCVariable } from '@root/types/PLC/open-plc'

type TextVariable = PLCVariable | LegacyPLCVariable

const classToVarBlock: Record<string, string> = {
  local: 'VAR',
  retain: 'VAR RETAIN',
  input: 'VAR_INPUT',
  output: 'VAR_OUTPUT',
  inout: 'VAR_IN_OUT',
  external: 'VAR_EXTERNAL',
  global: 'VAR_GLOBAL',
  globalRetain: 'VAR_GLOBAL RETAIN',
  temp: 'VAR_TEMP',
}

export const generateIecVariablesToString = (variables: TextVariable[]): string => {
  if (!variables || variables.length === 0) {
    return 'VAR\nEND_VAR'
  }

  const groupedVariables = variables.reduce(
    (acc, variable) => {
      const key =
        variable.retain && (!variable.class || variable.class === 'global')
          ? 'globalRetain'
          : variable.class === 'local' && variable.retain
            ? 'retain'
            : (variable.class ?? 'global').toLowerCase()

      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(variable)
      return acc
    },
    {} as Record<string, TextVariable[]>,
  )

  let textualDeclaration = ''
  const orderedGroups = ['global', 'globalRetain', 'external', 'input', 'output', 'inout', 'local', 'retain', 'temp']

  orderedGroups.forEach((groupName) => {
    if (groupedVariables[groupName]) {
      const blockHeader = classToVarBlock[groupName]
      textualDeclaration += `${blockHeader}\n`

      groupedVariables[groupName].forEach((v) => {
        let line = `\t${v.name}`

        if (v.location) {
          line += ` AT ${v.location}`
        }

        const typeText =
          v.type.definition === 'array'
            ? `ARRAY [${v.type.data.dimensions.map(({ dimension }) => dimension).join(', ')}] OF ${v.type.data.baseType.definition === 'base-type' ? v.type.data.baseType.value.toUpperCase() : v.type.data.baseType.value}`
            : v.type.value
        line += ` : ${typeText}`

        if (v.initialValue) {
          line += ` := ${v.initialValue}`
        }

        line += ';'

        if (v.documentation) {
          const singleLineDoc = v.documentation.replace(/(\r\n|\n|\r)/gm, ' ').trim()
          if (singleLineDoc) {
            line += ` (* ${singleLineDoc} *)`
          }
        }

        textualDeclaration += line + '\n'
      })

      textualDeclaration += `END_VAR\n\n`
    }
  })

  return textualDeclaration.trim()
}
