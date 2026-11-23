import type { PLCProjectData } from '../../../src/types/PLC/open-plc'

export const gvlFixture = (): PLCProjectData => ({
  dataTypes: [],
  globalVariableLists: [
    {
      name: 'GVL_IO',
      documentation: '',
      variables: [
        { name: 'Lamp', type: { definition: 'base-type', value: 'bool' }, location: '%QX120.6', documentation: '' },
        { name: 'Input', type: { definition: 'base-type', value: 'bool' }, location: '%IX100.0', documentation: '' },
        { name: 'AnalogIn', type: { definition: 'base-type', value: 'int' }, location: '%IW1000', documentation: '' },
        { name: 'AnalogOut', type: { definition: 'base-type', value: 'int' }, location: '%QW1200', documentation: '' },
      ],
    },
    {
      name: 'GVL_State',
      documentation: '',
      variables: [
        {
          name: 'Volatile',
          type: { definition: 'base-type', value: 'udint' },
          location: '',
          initialValue: '7',
          documentation: '',
        },
        {
          name: 'Count',
          type: { definition: 'base-type', value: 'udint' },
          location: '',
          initialValue: '42',
          retain: true,
          documentation: '',
        },
      ],
    },
  ],
  pous: [
    {
      type: 'program',
      data: {
        name: 'main',
        language: 'st',
        variables: [],
        documentation: '',
        body: {
          language: 'st',
          value:
            'GVL_IO.Lamp := GVL_IO.Input;\nGVL_IO.AnalogOut := GVL_IO.AnalogIn + 1;\nGVL_State.Count := GVL_State.Count + 1;\nGVL_State.Volatile := GVL_State.Volatile + 1;',
        },
      },
    },
  ],
  configuration: {
    resource: {
      globalVariables: [],
      tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#10ms', priority: 0 }],
      instances: [{ name: 'instance0', task: 'task0', program: 'main' }],
    },
  },
})

/** Several retained globals, including an unused member and repeated member names across lists. */
export function multiRetainGvlFixture(): PLCProjectData {
  const project = gvlFixture()
  const retained = (name: string, value: 'udint' | 'bool' | 'dint', initialValue: string) => ({
    name,
    type: { definition: 'base-type' as const, value },
    location: '',
    documentation: '',
    initialValue,
    retain: true as const,
  })
  project.globalVariableLists![1].variables.push(retained('Marker', 'udint', '123456'))
  project.globalVariableLists!.push({
    name: 'GVL_Second',
    documentation: '',
    variables: [
      retained('Count', 'udint', '17'),
      retained('Enabled', 'bool', 'TRUE'),
      { name: 'Scratch', type: { definition: 'base-type', value: 'udint' }, location: '', documentation: '' },
      retained('Signed', 'dint', '-7'),
    ],
  })
  return project
}
