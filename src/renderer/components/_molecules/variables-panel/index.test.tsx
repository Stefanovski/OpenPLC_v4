/** @jest-environment jsdom */

import '@testing-library/jest-dom'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { VariablesPanel } from './index'

jest.mock('@root/renderer/assets/icons/interface/View', () => ({
  __esModule: true,
  default: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='view-icon' {...props} />,
}))

jest.mock('@root/renderer/assets/icons/interface/Zap', () => ({
  __esModule: true,
  default: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid='zap-icon' {...props} />,
}))

describe('VariablesPanel', () => {
  it('keeps the selected variable while the Force Value dialog is open', async () => {
    const onForceVariable = jest.fn().mockResolvedValue(undefined)

    render(
      <VariablesPanel
        variables={[{ name: 'aoutch0', type: 'INT', value: '0', compositeKey: 'main:aoutch0' }]}
        setGraphList={jest.fn()}
        graphList={[]}
        debugVariableIndexes={new Map([['main:aoutch0', 43]])}
        debugForcedVariables={new Map()}
        isDebuggerVisible
        onForceVariable={onForceVariable}
      />,
    )

    fireEvent.click(screen.getByText('aoutch0'))
    fireEvent.click(await screen.findByText('Force Value'))

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => {
      expect(onForceVariable).toHaveBeenCalledWith('main:aoutch0', 'INT', true, new Uint8Array([0, 1]), 'main:aoutch0')
    })
  })

  it('modifies a typed variable without forcing it', async () => {
    const onModifyVariable = jest.fn().mockResolvedValue(undefined)

    render(
      <VariablesPanel
        variables={[{ name: 'setpoint', type: 'INT', value: '0', compositeKey: 'main:setpoint' }]}
        setGraphList={jest.fn()}
        graphList={[]}
        debugVariableIndexes={new Map([['main:setpoint', 7]])}
        debugForcedVariables={new Map()}
        isDebuggerVisible
        onModifyVariable={onModifyVariable}
      />,
    )

    fireEvent.click(screen.getByText('setpoint'))
    fireEvent.click(await screen.findByText('Modify Value'))
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    await waitFor(() => {
      expect(onModifyVariable).toHaveBeenCalledWith(
        'main:setpoint',
        'INT',
        false,
        new Uint8Array([255, 133]),
        'main:setpoint',
      )
    })
  })

  it('offers direct BOOL modifications separately from force operations', async () => {
    const onModifyVariable = jest.fn().mockResolvedValue(undefined)
    const onForceVariable = jest.fn().mockResolvedValue(undefined)

    render(
      <VariablesPanel
        variables={[{ name: 'enabled', type: 'BOOL', value: 'FALSE', compositeKey: 'main:enabled' }]}
        setGraphList={jest.fn()}
        graphList={[]}
        debugVariableIndexes={new Map([['main:enabled', 3]])}
        debugForcedVariables={new Map()}
        isDebuggerVisible
        onModifyVariable={onModifyVariable}
        onForceVariable={onForceVariable}
      />,
    )

    fireEvent.click(screen.getByText('enabled'))
    fireEvent.click(await screen.findByText('Modify to True'))

    await waitFor(() => {
      expect(onModifyVariable).toHaveBeenCalledWith('main:enabled', 'BOOL', true, new Uint8Array([1]), 'main:enabled')
    })
    expect(onForceVariable).not.toHaveBeenCalled()
  })
})
