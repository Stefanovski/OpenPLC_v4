import { isAbsolute, relative, resolve, sep } from 'node:path'

const IEC_DEBUG_METADATA_FILE = 'program.debug.json'

export const resolveIecDebugMetadataPath = (projectPath: string, boardTarget: string): string | null => {
  const targetDirectory = boardTarget.trim()
  if (!targetDirectory || isAbsolute(targetDirectory) || /[\\/]/.test(targetDirectory)) return null

  const buildDirectory = resolve(projectPath, 'build')
  const metadataPath = resolve(buildDirectory, targetDirectory, 'src', IEC_DEBUG_METADATA_FILE)
  const relativeMetadataPath = relative(buildDirectory, metadataPath)
  if (
    !relativeMetadataPath ||
    relativeMetadataPath === '..' ||
    relativeMetadataPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeMetadataPath)
  ) {
    return null
  }

  return metadataPath
}
