import { resolve } from 'node:path'

import { resolveIecDebugMetadataPath } from './iec-debug-metadata-path'

describe('IEC debug metadata path', () => {
  const projectPath = resolve('test-project')

  it('accepts arbitrary board display names', () => {
    expect(resolveIecDebugMetadataPath(projectPath, 'Otto')).toBe(
      resolve(projectPath, 'build', 'Otto', 'src', 'program.debug.json'),
    )
    expect(resolveIecDebugMetadataPath(projectPath, 'Eurosonic_Gen2_8KW')).toBe(
      resolve(projectPath, 'build', 'Eurosonic_Gen2_8KW', 'src', 'program.debug.json'),
    )
  })

  it('rejects paths that could escape the project build directory', () => {
    expect(resolveIecDebugMetadataPath(projectPath, '')).toBeNull()
    expect(resolveIecDebugMetadataPath(projectPath, '..')).toBeNull()
    expect(resolveIecDebugMetadataPath(projectPath, '../Otto')).toBeNull()
    expect(resolveIecDebugMetadataPath(projectPath, resolve('outside'))).toBeNull()
  })
})
