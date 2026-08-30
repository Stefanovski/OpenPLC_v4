type BoardCompilerInfo = {
  compiler: string
}

/**
 * Determines if a board is an Arduino target based on its compiler.
 * Arduino targets use 'arduino-cli' compiler, while OpenPLC Runtime uses 'openplc-compiler'.
 *
 * @param boardInfo - The board information from availableBoards map
 * @returns true if the board is an Arduino target, false if it's OpenPLC Runtime
 */
export function isArduinoTarget(boardInfo: BoardCompilerInfo | undefined): boolean {
  if (!boardInfo) {
    return false
  }
  return boardInfo.compiler === 'arduino-cli'
}

/**
 * Determines if a board is an OpenPLC Runtime target based on its compiler.
 *
 * @param boardInfo - The board information from availableBoards map
 * @returns true if the board is an OpenPLC Runtime target, false otherwise
 */
export function isOpenPLCRuntimeTarget(boardInfo: BoardCompilerInfo | undefined): boolean {
  if (!boardInfo) {
    return false
  }
  return boardInfo.compiler === 'openplc-compiler'
}

/**
 * Determines whether a compiler provides the Eurosonic target toolchain and
 * target-specific features. Board display names are deliberately irrelevant.
 */
export function isEurosonicCompiler(compiler: string | undefined): boolean {
  return compiler === 'eurosonic-cli'
}

/**
 * Determines whether a board uses the Eurosonic target toolchain.
 */
export function isEurosonicTarget(boardInfo: BoardCompilerInfo | undefined): boolean {
  return isEurosonicCompiler(boardInfo?.compiler)
}
