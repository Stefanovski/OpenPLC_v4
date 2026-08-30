import { isArduinoTarget, isEurosonicCompiler, isEurosonicTarget, isOpenPLCRuntimeTarget } from './device'

describe('device target capabilities', () => {
  it('detects target capabilities from the compiler instead of the board name', () => {
    const arbitrarilyNamedEurosonicBoard = { compiler: 'eurosonic-cli' }

    expect(isEurosonicTarget(arbitrarilyNamedEurosonicBoard)).toBe(true)
    expect(isEurosonicCompiler(arbitrarilyNamedEurosonicBoard.compiler)).toBe(true)
    expect(isArduinoTarget(arbitrarilyNamedEurosonicBoard)).toBe(false)
    expect(isOpenPLCRuntimeTarget(arbitrarilyNamedEurosonicBoard)).toBe(false)
  })

  it('does not grant Eurosonic capabilities to other compiler toolchains', () => {
    expect(isEurosonicTarget({ compiler: 'arduino-cli' })).toBe(false)
    expect(isEurosonicTarget({ compiler: 'openplc-compiler' })).toBe(false)
    expect(isEurosonicTarget(undefined)).toBe(false)
  })
})
