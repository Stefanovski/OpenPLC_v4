import { baseTypeSchema, genericTypeSchema } from '@root/types/PLC'
import type { PLCVariable } from '@root/types/PLC/units/variable'
import { resolveArrayVariableByName } from '@root/utils/PLC/array-variable-utils'
import { ZodLiteral } from 'zod'

import { BlockVariant } from '../ladder/block'
import { BlockVariant as newBlockVariant } from '../types/block'

type GenericTypeKey = keyof typeof genericTypeSchema.shape

const flattenGenericToBaseTypes = (genericName: string, visited: Set<string> = new Set()): string[] => {
  const key = genericName.toUpperCase()
  if (visited.has(key)) return []
  visited.add(key)

  const generic = genericTypeSchema.shape[key as GenericTypeKey] as { options?: unknown[] } | undefined
  if (!generic?.options) return []

  const result: string[] = []
  generic.options.forEach((option) => {
    if (typeof option === 'string') {
      result.push(option.toUpperCase())
      return
    }

    if (!(option instanceof ZodLiteral) || typeof option.value !== 'string') return

    if (option.value.startsWith('ANY_')) {
      result.push(...flattenGenericToBaseTypes(option.value, visited))
      return
    }

    result.push(option.value.toUpperCase())
  })

  return Array.from(new Set(result))
}

export const getVariableByName = (variables: PLCVariable[], name: string): PLCVariable | undefined => {
  const exact = variables.find((variable) => variable.name === name && variable.type.definition !== 'derived')
  if (exact) return exact

  return resolveArrayVariableByName(variables, name)
}

export const getBlockDocumentation = (blockVariant: newBlockVariant): string => {
  const inputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'input' || variable.class === 'inOut',
  )

  const outputVariables = blockVariant.variables.filter(
    (variable) => variable.class === 'output' || variable.class === 'inOut',
  )

  const documentationString = `${blockVariant.documentation ? `${blockVariant.documentation}\n\n` : ''}INPUT:
      ${inputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < inputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}

      OUTPUT:
      ${outputVariables
        .map(
          (variable, index) =>
            `${variable.name}: ${variable.type.value}${index < outputVariables.length - 1 ? '\n' : ''}`,
        )
        .join('')}`

  return documentationString
}

/**
 * Type validation function for the graphical editor.
 */
export const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0] | string,
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = typeof expectedType === 'string' ? expectedType : expectedType.type.value.toUpperCase()

  if (upperExpectedType === 'ANY') {
    return {
      isValid: true,
      error: undefined,
    }
  }

  // Handle generic types
  if (upperExpectedType.includes('ANY_')) {
    const validTypes = flattenGenericToBaseTypes(upperExpectedType)
    return {
      isValid: validTypes.includes(upperSelectedType),
      error: validTypes.includes(upperSelectedType) ? undefined : `Expected one of: ${validTypes.join(', ')}`,
    }
  }

  // Handle specific types
  return {
    isValid: upperSelectedType === upperExpectedType,
    error:
      upperSelectedType === upperExpectedType ? undefined : `Expected: ${upperExpectedType}, Got: ${upperSelectedType}`,
  }
}

export const getVariableRestrictionType = (variableType: string) => {
  if (variableType === 'ANY') {
    return {
      values: undefined,
      definition: undefined,
    }
  }

  if (variableType.includes('ANY_')) {
    const values = flattenGenericToBaseTypes(variableType)
    return {
      values: values.map((value) => value.toLowerCase()),
      definition: 'base-type',
    }
  }

  const isABaseType = baseTypeSchema.safeParse(variableType)

  return {
    // For base types, lowercase is fine (they're standardized and compared case-insensitively)
    // For derived/custom types, preserve original case to match user-defined type names
    values: isABaseType.success ? variableType.toLowerCase() : variableType,
    definition: isABaseType.success ? 'base-type' : 'derived',
  }
}
