const isMonacoWordHighlightCancellation = (reason: unknown): boolean => {
  if (!(reason instanceof Error) || reason.message !== 'Canceled') return false

  const stack = reason.stack ?? ''
  return stack.includes('Delayer.cancel') && stack.includes('WordHighlighter')
}

const installMonacoCancellationGuard = (): (() => void) => {
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (!isMonacoWordHighlightCancellation(event.reason)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const handleError = (event: ErrorEvent) => {
    if (!isMonacoWordHighlightCancellation(event.error as unknown)) return

    event.preventDefault()
    event.stopImmediatePropagation()
  }

  window.addEventListener('unhandledrejection', handleUnhandledRejection, true)
  window.addEventListener('error', handleError, true)

  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
    window.removeEventListener('error', handleError, true)
  }
}

export { installMonacoCancellationGuard, isMonacoWordHighlightCancellation }
