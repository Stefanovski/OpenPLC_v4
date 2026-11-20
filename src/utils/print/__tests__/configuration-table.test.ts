import { renderConfigurationTables } from '../configuration-table'

it('wraps long values without dropping text and repeats headers on page breaks', () => {
  const value = 'Parameter_ÄÖÜ_'.repeat(100)
  const blocks = renderConfigurationTables(
    [{ title: 'Tasks', columns: ['Name', 'Priority'], widths: [0.8, 0.2], rows: [[value, '1']] }],
    500,
    200,
  )
  expect(blocks.length).toBeGreaterThan(1)
  expect(blocks.every((b) => b.heightPt <= 200)).toBe(true)
  for (const block of blocks)
    expect(block.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', text: 'Tasks' }),
        expect.objectContaining({ kind: 'text', text: 'Name' }),
      ]),
    )
  const text = blocks
    .flatMap((b) => b.ops)
    .filter((op) => op.kind === 'text' && op.x === 4 && op.text !== 'Name')
    .map((op) => (op.kind === 'text' ? op.text : ''))
    .join('')
  expect(text).toBe(value)
})

it('prints an explicit empty section rather than JSON or a misleading blank table', () => {
  const blocks = renderConfigurationTables([{ title: 'Tasks', columns: ['Name'], widths: [1], rows: [] }], 500, 700)
  expect(blocks[0].ops).toContainEqual(expect.objectContaining({ kind: 'text', text: 'None' }))
})
