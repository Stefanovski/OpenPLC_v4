import type { PLCGlobalVariableList, PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'

import { parseIecStringToVariables } from '../generate-iec-string-to-variables'
import { isLegalIdentifier } from '../keywords'

export const gvlAlias = (list: string, member: string) => `${list}_${member}`

/** Strict wrapper: the general declaration reader intentionally tolerates surrounding POU text. */
export function parseGvlDeclarations(text: string, project: PLCProjectData): PLCVariable[] {
  let inside = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/^VAR_GLOBAL(?:\s+RETAIN)?$/i.test(line)) {
      if (inside) throw new Error('Nested VAR_GLOBAL block.')
      inside = true
    } else if (/^END_VAR$/i.test(line)) {
      if (!inside) throw new Error('Unexpected END_VAR.')
      inside = false
    } else if (!inside) throw new Error('GVLs require VAR_GLOBAL … END_VAR declarations.')
  }
  if (inside) throw new Error('Missing END_VAR in global variable list.')
  return parseIecStringToVariables(text, project.pous, project.dataTypes, undefined, { globalRetain: true })
}

export function resolvedGlobalVariableLists(project: PLCProjectData): PLCGlobalVariableList[] {
  return (project.globalVariableLists ?? []).map((list) => ({
    ...list,
    variables:
      list.variablesText === undefined
        ? list.variables
        : parseGvlDeclarations(list.variablesText, project).map((v) => ({
            ...v,
            debug: list.variables.find((old) => old.name.toLowerCase() === v.name.toLowerCase())?.debug ?? false,
          })),
  }))
}

type Member = { list: string; variable: PLCVariable; alias: string }

/** Ignore comments and strings while retaining source offsets (including nested IEC comments). */
function codeMask(source: string, cpp: boolean): string {
  const result = source.split('')
  const hide = (start: number, end: number) => {
    for (let p = start; p < end; p++) if (result[p] !== '\n' && result[p] !== '\r') result[p] = ' '
  }
  for (let i = 0; i < source.length; ) {
    const start = i
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i)
      if (i < 0) i = source.length
    } else if ((!cpp && source.startsWith('(*', i)) || (cpp && source.startsWith('/*', i))) {
      const open = cpp ? '/*' : '(*',
        close = cpp ? '*/' : '*)'
      let depth = 1
      i += 2
      while (i < source.length && depth) {
        if (!cpp && source.startsWith(open, i)) {
          depth++
          i += 2
        } else if (source.startsWith(close, i)) {
          depth--
          i += 2
        } else i++
      }
    } else if (cpp && source.startsWith('R"', i)) {
      const opening = source.indexOf('(', i + 2)
      if (opening < 0) throw new Error('Unclosed C++ raw string.')
      const terminator = `)${source.slice(i + 2, opening)}"`
      const end = source.indexOf(terminator, opening + 1)
      i = end < 0 ? source.length : end + terminator.length
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++]
      while (i < source.length) {
        if (source[i] === (cpp ? '\\' : '$')) i += 2
        else if (source[i++] === quote) break
      }
    } else {
      i++
      continue
    }
    hide(start, Math.min(i, source.length))
  }
  return result.join('')
}

function rewrite(source: string, members: Map<string, Member>, lists: Set<string>, used: Set<Member>, cpp: boolean) {
  const mask = codeMask(source, cpp)
  return rewriteAtOffsets(source, mask, members, lists, used)
}

function rewriteAtOffsets(
  source: string,
  mask: string,
  members: Map<string, Member>,
  lists: Set<string>,
  used: Set<Member>,
) {
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const match of mask.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const start = match.index
    if (!lists.has(match[1].toLowerCase()) || /\.\s*$/.test(mask.slice(0, start))) continue
    const member = members.get(`${match[1]}.${match[2]}`.toLowerCase())
    if (!member) throw new Error(`Unknown GVL member ${match[1]}.${match[2]}.`)
    const original = source.slice(start, start + match[0].length)
    // Keep debugger columns and line numbers exact; do not rewrite through comments or newlines.
    if (!/^[\w]+[ \t]*\.[ \t]*[\w]+$/.test(original))
      throw new Error(`Write ${match[1]}.${match[2]} on one line without comments inside the qualified name.`)
    used.add(member)
    edits.push({ start, end: start + original.length, text: member.alias.padEnd(original.length) })
  }
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  return source
}

/** Detached compiler input. Legacy projects without GVLs are returned unchanged. */
export function lowerGlobalVariableLists(project: PLCProjectData): PLCProjectData {
  if (!project.globalVariableLists?.length) return project
  const lists = resolvedGlobalVariableLists(project)
  const occupied = new Set(
    [
      ...project.configuration.resource.globalVariables.map((v) => v.name),
      ...project.dataTypes.map((t) => t.name),
      ...project.pous.flatMap((p) => [p.data.name, ...p.data.variables.map((v) => v.name)]),
    ].map((name) => name.toLowerCase()),
  )
  const names = new Set<string>()
  const members = new Map<string, Member>()
  const assertName = (name: string) => {
    const [legal, reason] = isLegalIdentifier(name)
    if (!legal) throw new Error(`GVL identifier "${name}" ${reason}.`)
    if (occupied.has(name.toLowerCase())) throw new Error(`GVL name collision: ${name}.`)
  }
  for (const list of lists) {
    assertName(list.name)
    occupied.add(list.name.toLowerCase())
    names.add(list.name.toLowerCase())
  }
  for (const list of lists)
    for (const variable of list.variables) {
      const [legal, reason] = isLegalIdentifier(variable.name)
      if (!legal) throw new Error(`GVL member "${variable.name}" ${reason}.`)
      const alias = gvlAlias(list.name, variable.name)
      assertName(alias)
      occupied.add(alias.toLowerCase())
      if (variable.retain && variable.location) throw new Error(`${list.name}.${variable.name}: RETAIN cannot use AT.`)
      if (variable.location && variable.type.definition !== 'base-type')
        throw new Error(`${list.name}.${variable.name}: AT currently requires an elementary type.`)
      members.set(`${list.name}.${variable.name}`.toLowerCase(), { list: list.name, variable, alias })
    }
  const copy = structuredClone(project)
  delete copy.globalVariableLists
  for (const member of members.values())
    copy.configuration.resource.globalVariables.push({ ...member.variable, name: member.alias })
  for (const pou of copy.pous) {
    const used = new Set<Member>()
    const replace = (source: string) => rewrite(source, members, names, used, pou.data.body.language === 'cpp')
    if (typeof pou.data.body.value === 'string') pou.data.body.value = replace(pou.data.body.value)
    else {
      // Only variable references in graphical nodes; never rename labels, IDs or comments.
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value)) {
          value.forEach(visit)
          return
        }
        const object = value as Record<string, unknown>
        if (object.variable && typeof object.variable === 'object') {
          const variable = object.variable as { name?: string }
          if (typeof variable.name === 'string') variable.name = replace(variable.name)
        }
        Object.values(object).forEach(visit)
      }
      visit(pou.data.body.value)
    }
    for (const member of used)
      pou.data.variables.push({
        name: member.alias,
        class: 'external',
        type: structuredClone(member.variable.type),
        location: '',
        documentation: '',
      })
    // Raw declarations are editor data; generated externals must not be overwritten by them.
    if (used.size) delete pou.data.variablesText
  }
  return copy
}

/** Display mapping only: addresses, debug table indices and stable IDs remain compiler-owned. */
export function displayGvlPath(path: string, project: PLCProjectData): string {
  for (const list of project.globalVariableLists ?? [])
    for (const variable of list.variables) {
      const alias = gvlAlias(list.name, variable.name)
      for (const prefix of ['CONFIG0.', 'CONFIG0__']) {
        const root = prefix + alias
        if (path.toUpperCase() === root.toUpperCase() || path.toUpperCase().startsWith(root.toUpperCase() + '.'))
          return prefix + list.name + '.' + variable.name + path.slice(root.length)
      }
    }
  return path
}
