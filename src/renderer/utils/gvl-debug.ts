import type { DebugTreeNode } from '@root/types/debugger'
import type { PLCProject } from '@root/types/PLC/open-plc'
import { gvlAlias } from '@root/utils/PLC/global-variable-lists'

import { buildDebugTree } from './debug-tree-builder'
import type { DebugVariable } from './parse-debug-file'

export function buildGvlDebugTrees(project: PLCProject, entries: DebugVariable[]): DebugTreeNode[] {
  return (project.data.globalVariableLists ?? []).flatMap((list) =>
    list.variables.map((variable) => {
      const alias = gvlAlias(list.name, variable.name)
      const name = `${list.name}.${variable.name}`
      const root = buildDebugTree({ ...variable, name: alias, class: 'external' }, 'resource', '', entries, project)
      const rename = (node: DebugTreeNode) => {
        node.compositeKey = node.compositeKey.replace(`resource:${alias}`, `resource:${name}`)
        node.children?.forEach(rename)
      }
      rename(root)
      root.name = name
      return root
    }),
  )
}
