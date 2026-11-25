import { cp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Copies the project's `libs/` folder (prebuilt `*.a` libraries and their headers) into the
 * Eurosonic build tree as `<build>/libs`. CMake links every `*.a` there and adds the folder to the
 * include path. The previous copy is removed first, so a replaced or deleted library never lingers.
 * The files are build inputs and are never modified.
 *
 * @returns true when a `libs/` folder was copied.
 */
export const copyEurosonicLibs = async (projectPath: string, compilationPath: string): Promise<boolean> => {
  const source = join(projectPath, 'libs')
  const target = join(compilationPath, 'libs')
  await rm(target, { recursive: true, force: true })
  const info = await stat(source).catch(() => null)
  if (!info) return false
  if (!info.isDirectory()) throw new Error(`${source} must be a folder`)
  await cp(source, target, { recursive: true })
  return true
}
