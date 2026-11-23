import type { PLCGlobalVariableList, PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'
import { lowerGlobalVariableLists, parseGvlDeclarations } from '@root/utils/PLC/global-variable-lists'

import { printType } from './print-configuration'

export const gvlDeclarations = (variables: PLCVariable[]) =>
  variables.length ? generateIecVariablesToString(variables) : 'VAR_GLOBAL\nEND_VAR'

/** Validate the declaration namespace without requiring complete POU bodies. */
export function validateGvlLists(project: PLCProjectData, lists: PLCGlobalVariableList[]) {
  const input = structuredClone(project)
  for (const pou of input.pous) pou.data.body = { language: 'st', value: '' }
  lowerGlobalVariableLists({ ...input, globalVariableLists: lists })
}

export function gvlFromText(list: PLCGlobalVariableList, text: string, project: PLCProjectData): PLCGlobalVariableList {
  let variables = list.variables
  try {
    variables = parseGvlDeclarations(text, project).map((v) => ({
      ...v,
      debug: list.variables.find((old) => old.name.toLowerCase() === v.name.toLowerCase())?.debug ?? false,
    }))
  } catch {
    // Preserve incomplete table edits exactly like incomplete text declarations.
  }
  return { ...list, variablesText: text, variables }
}

export type GvlCell = 'name' | 'type' | 'location' | 'initialValue' | 'documentation' | 'retain'

export function editGvlCell(list: PLCGlobalVariableList, index: number, field: GvlCell, value: string | boolean) {
  return list.variables
    .map((v, i) => {
      if (i !== index) return gvlDeclarations([v])
      const row = {
        name: v.name,
        type: printType(v.type),
        location: v.location,
        initialValue: v.initialValue ?? '',
        documentation: v.documentation,
        retain: v.retain ?? false,
        [field]: value,
      }
      const documentation = row.documentation.replace(/[\r\n]+/g, ' ')
      return `VAR_GLOBAL${row.retain ? ' RETAIN' : ''}\n${row.name}${row.location ? ` AT ${row.location}` : ''} : ${row.type}${row.initialValue ? ` := ${row.initialValue}` : ''};${documentation ? ` (* ${documentation} *)` : ''}\nEND_VAR`
    })
    .join('\n\n')
}

/** A copied IO declaration must not introduce a second writer to the same physical output. */
export function duplicateGvl(project: PLCProjectData, list: PLCGlobalVariableList): PLCGlobalVariableList {
  const variables =
    list.variablesText === undefined ? list.variables : parseGvlDeclarations(list.variablesText, project)
  const occupied = new Set(
    [
      ...(project.globalVariableLists ?? []).flatMap((v) => [
        v.name,
        ...v.variables.map((member) => `${v.name}_${member.name}`),
      ]),
      ...project.configuration.resource.globalVariables.map((v) => v.name),
      ...project.dataTypes.map((v) => v.name),
      ...project.pous.flatMap((p) => [p.data.name, ...p.data.variables.map((v) => v.name)]),
    ].map((name) => name.toLowerCase()),
  )
  for (let suffix = 1; suffix <= 10000; suffix++) {
    const name = `${list.name}_Copy${suffix === 1 ? '' : suffix}`
    if (occupied.has(name.toLowerCase()) || variables.some((v) => occupied.has(`${name}_${v.name}`.toLowerCase())))
      continue
    const copy: PLCGlobalVariableList = {
      ...structuredClone(list),
      name,
      variables: variables.map((v) => ({ ...structuredClone(v), location: '', debug: false })),
    }
    copy.variablesText = gvlDeclarations(copy.variables)
    validateGvlLists(project, [...(project.globalVariableLists ?? []), copy])
    return copy
  }
  throw new Error('No available name for the duplicated list.')
}
