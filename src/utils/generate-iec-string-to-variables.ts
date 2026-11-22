import { LibraryState } from '@root/renderer/store/slices/library/type'
import { baseTypeSchema, PLCDataType, PLCPou, PLCVariable } from '@root/types/PLC/open-plc'

const varBlockToClass: Record<string, PLCVariable['class']> = {
  VAR: 'local',
  VAR_INPUT: 'input',
  VAR_OUTPUT: 'output',
  VAR_IN_OUT: 'inOut',
  VAR_EXTERNAL: 'external',
  VAR_TEMP: 'temp',
  VAR_GLOBAL: 'global',
}

const standardLineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)(?:\s+AT\s+(?<location>%[\w\d\._]+))?\s*:\s*(?<type>[\w\s\[\]\.\-,]+?)\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

// OpenPLC v4.1.0 briefly serialized AT after the type. Accept that form when
// reading so projects saved with either editor version remain loadable.
const typeFirstLineRegex =
  // eslint-disable-next-line no-useless-escape
  /^\s*(?<name>\w+)\s*:\s*(?<type>[\w\s\[\]\.\-,]+?)(?:\s+AT\s+(?<location>%[\w\d\._]+))?\s*(?::=\s*(?<initialValue>[^;]+?))?\s*;\s*(?:\(\*\s*(?<documentation>.*?)\s*\*\))?$/

const guessErrorReason = (line: string): string => {
  if (!line.includes(';')) return 'missing semicolon (;) at the end of the declaration'
  if (!line.includes(':')) return 'missing colon (:) between name and type'
  // eslint-disable-next-line no-useless-escape
  if (/[^A-Za-z0-9_\s:;=%()/*\-.\[\]]/.test(line)) return 'invalid or unsupported characters'
  return 'unrecognized declaration format'
}

/**
 * Type guard to check if a library object has a 'pous' property
 */
const hasLibraryPous = (lib: unknown): lib is { pous: Array<{ name: string; type: string }> } => {
  return typeof lib === 'object' && lib !== null && 'pous' in lib && Array.isArray((lib as { pous: unknown }).pous)
}

// Preserve the structured array model when switching between table and text.
const parseArrayType = (text: string): PLCVariable['type'] | null => {
  const match = /^ARRAY\s*\[([^\]]+)\]\s+OF\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i.exec(text)
  if (!match) return null
  const dimensions = match[1].split(',').map((dimension) => dimension.trim())
  if (dimensions.some((dimension) => !dimension)) return null
  const base = baseTypeSchema.safeParse(match[2].toLowerCase())
  return {
    definition: 'array',
    value: `ARRAY [${dimensions.join(', ')}] OF ${base.success ? base.data.toUpperCase() : match[2]}`,
    data: {
      baseType: base.success
        ? { definition: 'base-type', value: base.data }
        : { definition: 'user-data-type', value: match[2] },
      dimensions: dimensions.map((dimension) => ({ dimension })),
    },
  }
}

export const parseIecStringToVariables = (
  iecString: string,
  pous?: PLCPou[],
  _dataTypes?: PLCDataType[], // Reserved for future use: will enable user-defined data type validation
  libraries?: LibraryState['libraries'],
  options?: { globalRetain?: boolean },
): PLCVariable[] => {
  const variables: PLCVariable[] = []
  const lines = iecString.split(/\r?\n/)
  let currentClass: PLCVariable['class'] | null = null
  let retain = false

  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1
    const line = rawLine.trim()
    if (line === '') return

    const blockStart = line.match(
      /^(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_EXTERNAL|VAR_TEMP|VAR_GLOBAL|VAR)\b(?:\s+(RETAIN)\b)?/i,
    )
    if (blockStart) {
      currentClass = varBlockToClass[blockStart[1].toUpperCase()]
      retain = Boolean(blockStart[2])
      if (retain && currentClass !== 'local' && !(currentClass === 'global' && options?.globalRetain)) {
        throw new Error(`Syntax error on line ${lineNumber}: RETAIN is supported in local VAR blocks.`)
      }
      return
    }

    if (/^END_VAR\b/i.test(line)) {
      currentClass = null
      return
    }

    if (!currentClass) return

    const match = line.match(standardLineRegex) ?? line.match(typeFirstLineRegex)
    if (!match || !match.groups) {
      throw new Error(`Syntax error on line ${lineNumber}: "${line}". Possible cause: ${guessErrorReason(line)}.`)
    }

    const { name, location, type, initialValue, documentation } = match.groups
    if (retain && location) {
      throw new Error(`Syntax error on line ${lineNumber}: RETAIN cannot be used with an AT address.`)
    }

    const disallowedLocationClasses: Array<PLCVariable['class']> = ['input', 'output', 'inOut', 'external', 'temp']

    if (location && disallowedLocationClasses.includes(currentClass)) {
      throw new Error(
        `Syntax error on line ${lineNumber}: Location ("AT") is not allowed for variables of class "${currentClass.toUpperCase()}".`,
      )
    }

    if (initialValue && currentClass === 'external') {
      throw new Error(
        `Syntax error on line ${lineNumber}: Initial Value (":=") is not allowed for variables of class "EXTERNAL".`,
      )
    }

    if (variables.some((variable) => variable.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Syntax error on line ${lineNumber}: Variable "${name}" is declared more than once.`)
    }

    const parsedType = type.trim()
    const arrayType = parseArrayType(parsedType)
    if (!arrayType && (/^ARRAY\b/i.test(parsedType) || /[,-]/.test(parsedType))) {
      throw new Error(`Syntax error on line ${lineNumber}: Invalid ARRAY declaration or misplaced comma.`)
    }
    const baseCheck = baseTypeSchema.safeParse(parsedType.toLowerCase())

    const isUserFunctionBlock = pous?.some(
      (pou) => pou.type === 'function-block' && pou.data.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isSystemFunctionBlock = libraries?.system.some((lib) => {
      if (!hasLibraryPous(lib)) return false
      return lib.pous.some(
        (pou) => pou.type === 'function-block' && pou.name.toLowerCase() === parsedType.toLowerCase(),
      )
    })

    const isUserLibraryFunctionBlock = libraries?.user.some(
      (lib) => lib.type === 'function-block' && lib.name.toLowerCase() === parsedType.toLowerCase(),
    )

    const isFunctionBlock = isUserFunctionBlock || isSystemFunctionBlock || isUserLibraryFunctionBlock

    const typeDefinition: PLCVariable['type'] =
      arrayType ??
      (baseCheck.success
        ? { definition: 'base-type' as const, value: baseCheck.data }
        : isFunctionBlock
          ? { definition: 'derived' as const, value: parsedType }
          : { definition: 'user-data-type' as const, value: parsedType })

    variables.push({
      name: name.trim(),
      class: currentClass,
      type: typeDefinition,
      location: location ? location.trim() : '',
      initialValue: initialValue ? initialValue.trim() : null,
      ...(retain ? { retain: true as const } : {}),
      documentation: documentation ? documentation.trim() : '',
      debug: false,
    })
  })

  return variables
}
