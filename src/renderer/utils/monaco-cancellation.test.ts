/** @jest-environment jsdom */

import { installMonacoCancellationGuard, isMonacoWordHighlightCancellation } from './monaco-cancellation'

const createMonacoCancellation = (): Error => {
  const error = new Error('Canceled')
  error.stack = [
    'Canceled: Canceled',
    '    at Delayer.cancel (renderer.dev.js:84305:29)',
    '    at WordHighlighter.dispose (renderer.dev.js:236202:23)',
  ].join('\n')
  return error
}

describe('Monaco cancellation guard', () => {
  it('recognizes only the benign WordHighlighter cancellation', () => {
    expect(isMonacoWordHighlightCancellation(createMonacoCancellation())).toBe(true)
    expect(isMonacoWordHighlightCancellation('Canceled')).toBe(false)
    expect(isMonacoWordHighlightCancellation(new Error('Different failure'))).toBe(false)

    const unrelatedCancellation = new Error('Canceled')
    unrelatedCancellation.stack = 'Canceled: Canceled\n    at Delayer.cancel (other-feature.js:1:1)'
    expect(isMonacoWordHighlightCancellation(unrelatedCancellation)).toBe(false)
  })

  it('suppresses matching rejection and error events but leaves other failures alone', () => {
    const listeners = new Map<string, EventListener>()
    const addEventListener = jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listener as EventListener)
      })
    const removeEventListener = jest.spyOn(window, 'removeEventListener').mockImplementation(() => undefined)
    const uninstall = installMonacoCancellationGuard()
    const rejectionListener = listeners.get('unhandledrejection') as (event: PromiseRejectionEvent) => void
    const errorListener = listeners.get('error') as (event: ErrorEvent) => void
    const rejectionPreventDefault = jest.fn()
    const rejectionStopPropagation = jest.fn()
    const errorPreventDefault = jest.fn()
    const errorStopPropagation = jest.fn()
    const unrelatedPreventDefault = jest.fn()
    const unrelatedStopPropagation = jest.fn()
    const rejectionEvent = {
      reason: createMonacoCancellation(),
      preventDefault: rejectionPreventDefault,
      stopImmediatePropagation: rejectionStopPropagation,
    } as unknown as PromiseRejectionEvent
    const errorEvent = {
      error: createMonacoCancellation(),
      preventDefault: errorPreventDefault,
      stopImmediatePropagation: errorStopPropagation,
    } as unknown as ErrorEvent
    const unrelatedEvent = {
      reason: new Error('Real failure'),
      preventDefault: unrelatedPreventDefault,
      stopImmediatePropagation: unrelatedStopPropagation,
    } as unknown as PromiseRejectionEvent

    rejectionListener(rejectionEvent)
    errorListener(errorEvent)
    rejectionListener(unrelatedEvent)

    expect(rejectionPreventDefault).toHaveBeenCalledTimes(1)
    expect(rejectionStopPropagation).toHaveBeenCalledTimes(1)
    expect(errorPreventDefault).toHaveBeenCalledTimes(1)
    expect(errorStopPropagation).toHaveBeenCalledTimes(1)
    expect(unrelatedPreventDefault).not.toHaveBeenCalled()
    expect(unrelatedStopPropagation).not.toHaveBeenCalled()

    uninstall()
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', rejectionListener, true)
    expect(addEventListener).toHaveBeenCalledWith('error', errorListener, true)
    expect(removeEventListener).toHaveBeenCalledWith('unhandledrejection', rejectionListener, true)
    expect(removeEventListener).toHaveBeenCalledWith('error', errorListener, true)
  })
})
