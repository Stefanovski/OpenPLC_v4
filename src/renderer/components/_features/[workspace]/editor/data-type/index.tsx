import { ArrayDataType } from '@root/renderer/components/_molecules/data-types/array'
import { EnumeratorDataType } from '@root/renderer/components/_molecules/data-types/enumerated'
import { StructureDataType } from '@root/renderer/components/_molecules/data-types/structure'
import { datatypeSelectors } from '@root/renderer/hooks'
import { ComponentPropsWithoutRef } from 'react'

type DatatypeEditorProps = ComponentPropsWithoutRef<'div'> & {
  dataTypeName: string
}

const DataTypeEditor = ({ dataTypeName, ...rest }: DatatypeEditorProps) => {
  const dataTypes = datatypeSelectors.useDatatypes()
  const editorContent = dataTypes.find((dataType) => dataType.name === dataTypeName)

  return (
    <div aria-label='Data type editor container' className='flex h-full w-full flex-col gap-4' {...rest}>
      <div className='h-full w-full overflow-hidden'>
        {editorContent?.derivation === 'array' && <ArrayDataType data={editorContent} />}
        {editorContent?.derivation === 'enumerated' && <EnumeratorDataType data={editorContent} />}
        {editorContent?.derivation === 'structure' && <StructureDataType />}
      </div>
    </div>
  )
}

export { DataTypeEditor }
