import type { PLCVariable } from '@root/types/PLC/open-plc'
import { getVariableIECType } from '@root/utils/PLC/array-codegen-helpers'
import { parseDimensionRange } from '@root/utils/PLC/array-variable-utils'

import type { CppPouData } from './generateCBlocksCode'

const entryPoints = (code: string) => {
  const masked = code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (text) =>
    text.replace(/[^\n]/g, ' '),
  )
  return [...masked.matchAll(/\bvoid\s+(setup|loop)\s*\(\s*(?:void\s*)?\)\s*(?=\{)/g)]
}

// Keep the established Arduino/runtime generator separate from the Eurosonic ABI.
const variablesFor = (variables: PLCVariable[]) =>
  variables.filter((v) => v.name.toLowerCase() !== 'hasbeeninitialized')

const dimensionsFor = (variable: PLCVariable) => {
  if (variable.type.definition !== 'array') return []
  return variable.type.data.dimensions.map(({ dimension }) => {
    const range = parseDimensionRange(dimension)
    if (!range) throw new Error(`Invalid C++ array range: ${variable.name}[${dimension}]`)
    return { lower: range.lower, size: range.upper - range.lower + 1 }
  })
}

export const validateEurosonicCpp = (pou: CppPouData, pouType = 'function-block') => {
  const entries = entryPoints(pou.code)
  for (const name of ['setup', 'loop']) {
    if (entries.filter((entry) => entry[1] === name).length !== 1) {
      return { valid: false, error: `C++ block must define exactly one void ${name}() function.` }
    }
  }
  if (pouType !== 'function-block') return { valid: false, error: 'Eurosonic C++ requires a function block.' }
  const names = new Set<string>()
  for (const v of pou.variables) {
    const name = v.name.toLowerCase()
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v.name) ||
      names.has(name) ||
      ['hasbeeninitialized', 'vars', 'setup', 'loop'].includes(name)
    ) {
      return { valid: false, error: `Invalid, duplicate or reserved C++ variable name: ${v.name}` }
    }
    names.add(name)
    if (!['input', 'output', 'inOut', 'local', 'temp', 'external'].includes(v.class ?? '')) {
      return { valid: false, error: `Unsupported C++ variable class: ${v.name}` }
    }
    // xml2st's legacy pipeline rewrites user STRUCTs as function blocks. Their
    // storage is not an IEC scalar wrapper; never guess that ABI in native code.
    if (
      v.type.definition !== 'base-type' &&
      !(v.type.definition === 'array' && v.type.data.baseType.definition === 'base-type')
    ) {
      return {
        valid: false,
        error: `C++ variable ${v.name}: use elementary IEC types or arrays of elementary types; user-defined types and FB instances require a separate ABI adapter.`,
      }
    }
    try {
      const dimensions = dimensionsFor(v)
      if (
        v.type.definition === 'array' &&
        (dimensions.length === 0 || dimensions.reduce((n, d) => n * d.size, 1) > 4096)
      ) {
        return { valid: false, error: `C++ array ${v.name} must contain 1 to 4096 elements.` }
      }
    } catch (error) {
      return { valid: false, error: (error as Error).message }
    }
  }
  return { valid: true }
}

export const generateEurosonicCppHeader = (pous: CppPouData[]) => `#ifndef C_BLOCKS_H
#define C_BLOCKS_H
#ifdef __cplusplus
extern "C" {
#endif
${pous
  .map(
    (pou) => `typedef struct {
${
  variablesFor(pou.variables)
    .map((v) => `  void *${v.name.toUpperCase()};`)
    .join('\n') || '  void *unused;'
}
} ${pou.name.toUpperCase()}_VARS;
void ${pou.name.toLowerCase()}_setup(${pou.name.toUpperCase()}_VARS *vars);
void ${pou.name.toLowerCase()}_loop(${pou.name.toUpperCase()}_VARS *vars);`,
  )
  .join('\n')}
#ifdef __cplusplus
}
#endif
#endif
`

// POUS.h also imports C-only runtime implementations. Export only MatIEC's
// actual type declarations, preserving its structure/enum/array layout exactly.
export const extractEurosonicCppTypes = (pousHeader: string) => {
  const end = pousHeader.search(/^\/\/ (?:FUNCTION|PROGRAM)/m)
  if (end < 0) throw new Error('Cannot locate MatIEC POU declarations for the C++ type bridge.')
  const prefix = pousHeader
    .slice(0, end)
    .replace(/^#(?:ifndef|define) __POUS_H\s*$/gm, '')
    .replace(/^#include[^\n]*$/gm, '')
  return `#pragma once\n#include "lib/iec_types_all.h"\n${prefix}\n`
}

// Index views preserve IEC lower bounds without constructing pointers outside
// the backing allocation. Multidimensional arrays use normal a[i][j] syntax.
const arrayView = `template<class T, int Lower, int Size, int... Rest>
struct EurosonicCppArray {
  T *data;
  static constexpr int count = Size * (EurosonicCppArray<T, Rest...>::count);
  auto operator[](int index) const {
    return EurosonicCppArray<T, Rest...>{data + (index - Lower) * EurosonicCppArray<T, Rest...>::count};
  }
};
template<class T, int Lower, int Size>
struct EurosonicCppArray<T, Lower, Size> {
  T *data;
  static constexpr int count = Size;
  T& operator[](int index) const { return data[index - Lower]; }
};
`

export const generateEurosonicCppSource = (pou: CppPouData[]) => {
  if (pou.length !== 1) throw new Error('Generate each Eurosonic C++ POU in its own translation unit.')
  const block = pou[0]
  const variables = variablesFor(block.variables)
  const validation = validateEurosonicCpp(block)
  if (!validation.valid) throw new Error(validation.error)
  const aliases = variables
    .map((v) => {
      const type = getVariableIECType(v)
      const dims = dimensionsFor(v)
      const value = dims.length
        ? `(EurosonicCppArray<${type}, ${dims.flatMap((d) => [d.lower, d.size]).join(', ')}>{static_cast<${type}*>(vars->${v.name.toUpperCase()})})`
        : `(*static_cast<${type}*>(vars->${v.name.toUpperCase()}))`
      return `#define ${v.name} ${value}`
    })
    .join('\n')
  let code = block.code
  const firstEntry = entryPoints(code)[0].index
  for (const entry of entryPoints(code).reverse()) {
    const index = entry.index
    code =
      code.slice(0, index) +
      `void ${block.name.toLowerCase()}_${entry[1]}(${block.name.toUpperCase()}_VARS *vars) ` +
      code.slice(index + entry[0].length)
  }
  // Leave user includes/helper declarations before the variable macros, so
  // names such as "Input" cannot rewrite declarations in standard headers.
  code = code.slice(0, firstEntry) + `\n${aliases}\n` + code.slice(firstEntry)
  return `#include "eurosonic_cpp_types.h"\n#include "c_blocks.h"\n${arrayView}\n${code}\n${variables.map((v) => `#undef ${v.name}`).join('\n')}\n`
}

export const generateEurosonicCppST = (pouName: string, allVariables: PLCVariable[], source = '') => {
  const declarations: string[] = [`${pouName.toUpperCase()}_VARS vars = {0};`]
  const snapshotSizes: string[] = [`sizeof(${pouName.toUpperCase()}_VARS)`]
  const copies: string[] = []
  for (const v of variablesFor(allVariables)) {
    const name = v.name.toUpperCase()
    const type = getVariableIECType(v)
    const access = v.class === 'external' ? 'EXTERNAL' : v.location ? 'LOCATED' : 'VAR'
    const dimensions = dimensionsFor(v)
    snapshotSizes.push(`sizeof(${type}) * ${dimensions.reduce((n, d) => n * d.size, 1)}`)
    if (dimensions.length === 0) {
      declarations.push(`${type} cpp_${name} = __GET_${access}(data__->${name});`, `vars.${name} = &cpp_${name};`)
      copies.push(`__SET_${access}(data__->,${name},,cpp_${name});`)
    } else {
      const count = dimensions.reduce((n, d) => n * d.size, 1)
      declarations.push(`${type} cpp_${name}[${count}];`, `vars.${name} = cpp_${name};`)
      const loops = dimensions.map((d, i) => `for (int cpp_i${i} = 0; cpp_i${i} < ${d.size}; ++cpp_i${i})`).join(' ')
      const indices = dimensions.map((_, i) => `[cpp_i${i}]`).join('')
      const flat = dimensions
        .map((_, i) => `cpp_i${i} * ${dimensions.slice(i + 1).reduce((n, d) => n * d.size, 1)}`)
        .join(' + ')
      declarations.push(`${loops} { cpp_${name}[${flat}] = __GET_${access}(data__->${name}).table${indices}.value; }`)
      const target = access === 'VAR' ? `data__->${name}.value` : `(*data__->${name}.value)`
      if (access === 'EXTERNAL') declarations.push(`extern IEC_BYTE __IS_GLOBAL_${name}_FORCED(void);`)
      const forced = access === 'EXTERNAL' ? ` && !__IS_GLOBAL_${name}_FORCED()` : ''
      copies.push(
        `if (!(data__->${name}.flags & __IEC_FORCE_FLAG)${forced}) { ${loops} { __SET_VAR(,${target}.table${indices},,cpp_${name}[${flat}]); } }`,
      )
    }
  }
  // The debugger/upload identity is computed from ST. Include native source in
  // a safe comment so a C++-only edit cannot reuse a stale program MD5.
  const identity = Array.from(source)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('.')
  return `(* Eurosonic C++ source: ${identity} *)
{{
_Static_assert(${snapshotSizes.join(' + ')} <= 1024, "C++ interface exceeds 1024 byte snapshot budget; reduce variables/arrays");
${declarations.join('\n')}
}}
IF NOT hasBeenInitialized THEN
{{ ${pouName.toLowerCase()}_setup(&vars); }}
hasBeenInitialized := TRUE;
END_IF;
{{
${pouName.toLowerCase()}_loop(&vars);
${copies.join('\n')}
}}`
}
