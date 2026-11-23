import { GlobalVariableListsEditor } from '@root/renderer/components/_organisms/global-variable-lists-editor'
import { GlobalVariablesEditor } from '@root/renderer/components/_organisms/global-variables-editor'
import { InstancesEditor } from '@root/renderer/components/_organisms/instances-editor'
import { TaskEditor } from '@root/renderer/components/_organisms/task-editor'

const ResourcesEditor = () => {
  return (
    <div className=' flex h-full w-full flex-col gap-8 overflow-y-auto'>
      <GlobalVariablesEditor />
      <GlobalVariableListsEditor />

      <TaskEditor />

      <InstancesEditor />
    </div>
  )
}

export { ResourcesEditor }
