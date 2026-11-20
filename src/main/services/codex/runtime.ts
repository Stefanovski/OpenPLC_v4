import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { delimiter, isAbsolute, join } from 'path'
import { promisify } from 'util'

import { CodexRpc, RpcObject } from './rpc'

/** Native executables only: never execute an npm .cmd/.ps1 wrapper through a shell. */
export function findCodexExecutable(selected?: string, env = process.env): string {
  if (selected) {
    if (
      !isAbsolute(selected) ||
      !existsSync(selected) ||
      (process.platform === 'win32' && !selected.toLowerCase().endsWith('.exe'))
    ) {
      throw new Error('Select an existing native Codex executable (codex.exe on Windows).')
    }
    return selected
  }
  const bundled = join(
    process.resourcesPath ?? '',
    'bin',
    'codex',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  )
  if (process.resourcesPath && existsSync(bundled)) return bundled
  const bundledBin = join(
    process.resourcesPath ?? '',
    'bin',
    'codex',
    'bin',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  )
  if (process.resourcesPath && existsSync(bundledBin)) return bundledBin
  const directories = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  if (env.APPDATA) directories.push(join(env.APPDATA, 'npm'))
  for (const directory of directories) {
    const direct = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    if (existsSync(direct)) return direct
    if (process.platform === 'win32') {
      const platform = process.arch === 'arm64' ? 'arm64' : 'x64'
      const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
      const root = join(directory, 'node_modules', '@openai', 'codex')
      for (const vendor of [
        join(root, 'node_modules', '@openai', `codex-win32-${platform}`, 'vendor'),
        join(root, 'vendor'),
      ]) {
        for (const folder of ['bin', 'codex']) {
          const binary = join(vendor, triple, folder, 'codex.exe')
          if (existsSync(binary)) return binary
        }
      }
    }
  }
  throw new Error('Codex CLI was not found. Install @openai/codex 0.157.x or select its native executable.')
}

export const chatConfig: Record<string, unknown> = {
  approval_policy: 'never',
  sandbox_mode: 'read-only',
  web_search: 'disabled',
  'features.shell_tool': false,
  'features.shell_snapshot': false,
  'features.apps': false,
  'features.plugins': false,
  'features.remote_plugin': false,
  'features.hooks': false,
  'features.multi_agent': false,
  'features.view_image': false,
  'features.code_mode.enabled': false,
  'analytics.enabled': false,
  cli_auth_credentials_store: 'keyring',
}

export async function startCodexRuntime(
  profile: string,
  selected: string | undefined,
  onNotification: (method: string, params: RpcObject) => void,
  onExit: (error: Error) => void,
): Promise<CodexRpc> {
  const executable = findCodexExecutable(selected)
  const { stdout } = await promisify(execFile)(executable, ['--version'], { windowsHide: true, timeout: 10000 })
  if (!/^codex-cli 0\.157\.\d+\b/.test(stdout.trim())) {
    throw new Error('This integration currently supports Codex CLI 0.157.x. Select a compatible runtime.')
  }
  const cwd = join(profile, 'chat-workspace')
  await mkdir(cwd, { recursive: true })
  const env = { ...process.env, CODEX_HOME: profile }
  // Neither the desktop session nor API credentials/settings are inherited.
  for (const key of Object.keys(env)) {
    if (/^(CODEX_|OPENAI_|CHATGPT_|ELECTRON_)/i.test(key) && key !== 'CODEX_HOME') delete env[key as keyof typeof env]
  }
  const args = ['app-server', '--listen', 'stdio://']
  for (const [key, value] of Object.entries(chatConfig)) args.push('-c', `${key}=${JSON.stringify(value)}`)
  const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: 'pipe' })
  return new CodexRpc(child, onNotification, onExit)
}
