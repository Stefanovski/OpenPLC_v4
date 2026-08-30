import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isEurosonicCompiler } from '@root/utils'

type BoardConfiguration = {
  compiler: string
  debug_transport?: 'modbus' | 'websocket'
  hidden?: boolean
}

describe('board configuration compatibility', () => {
  const hals = JSON.parse(
    readFileSync(resolve(process.cwd(), 'resources', 'sources', 'boards', 'hals.json'), 'utf8'),
  ) as Record<string, BoardConfiguration>

  it('grants Eurosonic capabilities through the compiler for every configured Eurosonic board', () => {
    const eurosonicBoards = Object.entries(hals).filter(([, board]) => isEurosonicCompiler(board.compiler))

    expect(eurosonicBoards.map(([name]) => name)).toEqual(
      expect.arrayContaining(['Eurosonic_Gen2_8KW', 'Agramkow_Gen2_3KW', 'Eurosonic_Gen2']),
    )
    expect(eurosonicBoards.every(([, board]) => isEurosonicCompiler(board.compiler))).toBe(true)
  })

  it('keeps the legacy Eurosonic target available without showing it as a new selection', () => {
    expect(hals.Eurosonic_Gen2).toMatchObject({ compiler: 'eurosonic-cli', hidden: true })
  })

  it('keeps both OpenPLC runtime targets available', () => {
    expect(hals['OpenPLC Runtime v3']).toMatchObject({ compiler: 'openplc-compiler', debug_transport: 'modbus' })
    expect(hals['OpenPLC Runtime v4']).toMatchObject({ compiler: 'openplc-compiler', debug_transport: 'websocket' })
  })
})
