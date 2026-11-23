import { GlobalVariableListsEditor } from '@root/renderer/components/_organisms/global-variable-lists-editor'
import { GlobalVariablesEditor } from '@root/renderer/components/_organisms/global-variables-editor'
import { InstancesEditor } from '@root/renderer/components/_organisms/instances-editor'
import { TaskEditor } from '@root/renderer/components/_organisms/task-editor'
import { useOpenPLCStore } from '@root/renderer/store'

const ResourcesEditor = () => {
  const { editor, editorActions } = useOpenPLCStore()
  const selected = editor.type === 'plc-resource' ? editor.meta.globalVariableList : undefined
  if (selected !== undefined)
    return (
      <div className='flex h-full w-full flex-col gap-4 overflow-y-auto'>
        <button
          className='self-start text-sm text-brand dark:text-brand-light'
          onClick={() => editorActions.selectGlobalVariableList(undefined)}
        >
          Back to Resource
        </button>
        <GlobalVariableListsEditor selectedName={selected} onSelect={editorActions.selectGlobalVariableList} />
      </div>
    )
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
