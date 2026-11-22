import { gvlFixture } from '../../../scripts/eurosonic/fixtures/gvl'
import { buildGvlDebugTrees } from './gvl-debug'

test('qualified watch names retain actual located debug table indices and C paths', () => {
  const data = gvlFixture()
  const trees = buildGvlDebugTrees({ meta: { name: 'test', type: 'plc-project' }, data }, [
    { name: 'CONFIG0__GVL_IO_LAMP', type: 'BOOL_O_ENUM', index: 3 },
    { name: 'CONFIG0__GVL_STATE_COUNT', type: 'UDINT_ENUM', index: 9 },
  ])
  expect(trees[0]).toMatchObject({
    name: 'GVL_IO.Lamp',
    compositeKey: 'resource:GVL_IO.Lamp',
    fullPath: 'CONFIG0__GVL_IO_LAMP',
    debugIndex: 3,
  })
  expect(trees.at(-1)).toMatchObject({ name: 'GVL_State.Count', debugIndex: 9 })
})
