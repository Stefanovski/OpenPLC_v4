import { PLCVariable } from '@root/types/PLC/open-plc'
import {
  getArrayStartIndex,
  getArrayTotalElements,
  getVariableIECType,
  isArrayVariable,
} from '@root/utils/PLC/array-codegen-helpers'

type STCodeGenerationParams = {
  pouName: string
  allVariables: PLCVariable[]
}

const generateFlatArrayDeclarations = (arrayVariables: PLCVariable[]): string =>
  arrayVariables
    .map(
      (variable) =>
        `${getVariableIECType(variable)} __flat_${variable.name.toUpperCase()}[${getArrayTotalElements(variable)}];\n`,
    )
    .join('')

const generateFlatArrayCopiesIn = (arrayVariables: PLCVariable[]): string =>
  arrayVariables
    .map((variable) => {
      const name = variable.name.toUpperCase()
      return `for (int __i = 0; __i < ${getArrayTotalElements(variable)}; __i++) __flat_${name}[__i] = data__->${name}.value.table[__i].value;\n`
    })
    .join('')

const generateVariableAssignment = (variable: PLCVariable): string => {
  const name = variable.name.toUpperCase()
  return isArrayVariable(variable)
    ? `vars.${name} = __flat_${name} - ${getArrayStartIndex(variable)};\n`
    : `vars.${name} = &data__->${name}.value;\n`
}

const generateOutputArrayCopyBack = (outputVariables: PLCVariable[]): string =>
  outputVariables
    .filter(isArrayVariable)
    .map((variable) => {
      const name = variable.name.toUpperCase()
      return `for (int __i = 0; __i < ${getArrayTotalElements(variable)}; __i++) data__->${name}.value.table[__i].value = __flat_${name}[__i];\n`
    })
    .join('')

const generateSTCode = (params: STCodeGenerationParams): string => {
  const { pouName, allVariables } = params

  const inputVariables = allVariables.filter((v) => v.class === 'input')
  const outputVariables = allVariables.filter((v) => v.class === 'output')

  const structName = `${pouName.toUpperCase()}_VARS`
  const setupFunctionName = `${pouName.toLowerCase()}_setup`
  const loopFunctionName = `${pouName.toLowerCase()}_loop`

  const allArrayVariables = [...inputVariables, ...outputVariables].filter(isArrayVariable)
  const flatArrayDeclarations = generateFlatArrayDeclarations(allArrayVariables)
  const flatArrayCopiesIn = generateFlatArrayCopiesIn(allArrayVariables)

  const variableAssignments = [...inputVariables, ...outputVariables].map(generateVariableAssignment).join('')
  const outputCopyBack = generateOutputArrayCopyBack(outputVariables)

  let stCode = `{{
${structName} vars;
${flatArrayDeclarations}${flatArrayCopiesIn}${variableAssignments}}}
if hasBeenInitialized = False then
{{
${setupFunctionName}(&vars);
}}
hasBeenInitialized := True;
end_if;
{{
${loopFunctionName}(&vars);
}}`

  if (outputCopyBack) {
    stCode += `\n{{
${outputCopyBack}}}`
  }

  return stCode
}

export { generateSTCode, type STCodeGenerationParams }
