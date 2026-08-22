import { useDebugCompositeKey } from '@root/renderer/hooks/use-debug-composite-key'
import { useOpenPLCStore } from '@root/renderer/store'

import { DebugValueBadge } from './debug-value-badge'

type BlockOutputDebugBadgesProps = {
  blockType: string
  blockName: string
  blockVariableName: string
  numericId: string
  outputVariables: Array<{ name: string; class: string; type: { definition: string; value: string } }>
  connectorStartY: number
  connectorOffsetY: number
  blockWidth: number
  connectedOutputNames?: Set<string>
}

/** Displays values for unconnected block outputs; connected variable nodes display their own badge. */
const BlockOutputDebugBadges = ({
  blockType,
  blockName,
  blockVariableName,
  numericId,
  outputVariables,
  connectorStartY,
  connectorOffsetY,
  blockWidth,
  connectedOutputNames,
}: BlockOutputDebugBadgesProps) => {
  const {
    workspace: { isDebuggerVisible },
  } = useOpenPLCStore()
  const getCompositeKey = useDebugCompositeKey()

  if (!isDebuggerVisible || blockType === 'generic') return null

  const outputs = outputVariables.filter((variable) => variable.class === 'output' || variable.class === 'inOut')

  return (
    <>
      {outputs.map((outputVariable, index) => {
        if (connectedOutputNames?.has(outputVariable.name)) return null

        const compositeKey =
          blockType === 'function-block'
            ? getCompositeKey(`${blockVariableName}.${outputVariable.name}`)
            : getCompositeKey(`_TMP_${blockName.toUpperCase()}${numericId}_${outputVariable.name}`)

        return (
          <div
            key={outputVariable.name}
            className='pointer-events-none absolute'
            style={{ top: connectorStartY + index * connectorOffsetY - 10, left: blockWidth }}
          >
            <DebugValueBadge compositeKey={compositeKey} variableType={outputVariable.type.value} position='right' />
          </div>
        )
      })}
    </>
  )
}

export { BlockOutputDebugBadges }
