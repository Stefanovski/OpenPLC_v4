import { mkdir, mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'

import { codexBuildRequestSchema, CodexBuildResult } from '../../../types/IPC/codex-build'
import { addCppLocalVariables } from '../../../utils/cpp/addCppLocalVariables'
import { generateEurosonicCppST, validateEurosonicCpp } from '../../../utils/cpp/eurosonic'
import { wrapUnsupportedComments } from '../../../utils/PLC/wrap-unsupported-comments'
import type { CompilerModule } from '../../modules/compiler/compiler-module'

export class CodexBuildService {
  private busy = false
  active() {
    return this.busy
  }
  constructor(
    private compiler: CompilerModule,
    private root: string,
  ) {}

  async compile(input: unknown): Promise<CodexBuildResult> {
    if (this.busy) throw new Error('A Codex compilation is already running. Wait for it to finish.')
    this.busy = true
    let directory: string | undefined
    let diagnostics = ''
    let success = false
    let board = ''
    const append = (text: string) => {
      diagnostics = (diagnostics + text + '\n').slice(-24000)
    }
    try {
      const request = codexBuildRequestSchema.parse(input)
      board = request.board
      const boards = JSON.parse(await readFile(this.compiler.halsFilePath, 'utf8')) as Record<
        string,
        { compiler?: string }
      >
      if (!Object.hasOwn(boards, request.board) || boards[request.board].compiler !== 'eurosonic-cli')
        throw new Error('Codex compilation currently supports Eurosonic targets only.')
      if (request.data.pous.some((p) => p.data.body.language === 'python'))
        throw new Error('Projects with Python POUs are not supported by Codex compilation yet.')
      const originals = request.data.pous
        .filter((p) => p.data.body.language === 'cpp')
        .map((p) => {
          const code = p.data.body.language === 'cpp' ? p.data.body.value : ''
          const validation = validateEurosonicCpp({ name: p.data.name, code, variables: p.data.variables }, p.type)
          if (!validation.valid) throw new Error(`POU ${p.data.name}: ${validation.error}`)
          return { name: p.data.name, code, variables: p.data.variables }
        })
      const data = addCppLocalVariables(request.data)
      for (const p of data.pous) {
        if (p.data.body.language === 'cpp')
          p.data.body = {
            language: 'st',
            value: generateEurosonicCppST(p.data.name, p.data.variables, p.data.body.value),
          }
        else if (p.data.body.language === 'st' || p.data.body.language === 'il')
          p.data.body.value = wrapUnsupportedComments(p.data.body.value)
      }
      await mkdir(this.root, { recursive: true })
      directory = await mkdtemp(join(this.root, 'build-'))
      // The normal compiler is reused, but its upload path is unreachable with compileOnly=true.
      await this.compiler.compileProgram(
        [directory, request.board, null, true, { ...data, originalCppPous: originals } as typeof data, null, null],
        {
          start() {},
          close() {},
          postMessage(value: { message?: string | Buffer; compilationSucceeded?: boolean }) {
            if (value.compilationSucceeded === true) success = true
            if (value.message) append(value.message.toString())
          },
        },
        { makeRuntimeApiRequest: () => Promise.reject(new Error('PLC access is disabled for Codex builds.')) },
      )
    } catch (error) {
      append(error instanceof Error ? error.message : String(error))
    } finally {
      if (directory) {
        if (!success) {
          // Map generated line numbers to bounded excerpts; never read a path supplied by the model.
          const locations = [...diagnostics.matchAll(/\b(program\.st|eurosonic_cpp_[A-Za-z0-9_]+\.cpp):(\d+)/g)].slice(
            0,
            4,
          )
          for (const match of locations) {
            const source = await readFile(join(directory, 'build', board, 'src', match[1]), 'utf8').catch(() => '')
            if (!source || source.length > 1000000) continue
            const lines = source.split(/\r?\n/),
              line = Number(match[2])
            const start = Math.max(0, line - 8)
            append(
              `Generated source excerpt (${match[1]}):\n` +
                lines
                  .slice(start, line + 5)
                  .map((text, index) => `${start + index + 1}: ${text}`)
                  .join('\n')
                  .slice(0, 3000),
            )
          }
        }
        diagnostics = diagnostics.split(directory).join('<temporary-build>')
        diagnostics = diagnostics.split(directory.replace(/\\/g, '/')).join('<temporary-build>')
        // Only the directory returned by mkdtemp under our dedicated root is removed.
        await rm(directory, { recursive: true, force: true }).catch(() => append('Temporary build cleanup failed.'))
      }
      this.busy = false
    }
    // Tool installation/configuration failures are not repairable by rewriting PLC source.
    const repairable =
      !success &&
      /(?:\bprogram\.st:\d|\beurosonic_cpp_[A-Za-z0-9_]+\.cpp:\d|undefined reference|^POU .*:)/im.test(diagnostics) &&
      !/(?:ENOENT|not recognized|unavailable|permission denied|Error copying static)/i.test(diagnostics)
    return { success, diagnostics, repairable }
  }
}
