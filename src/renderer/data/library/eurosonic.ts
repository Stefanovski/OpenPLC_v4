import { BaseLibrarySchema } from '@root/types/PLC'
import { z } from 'zod'

export const EurosonicLibrarySchema = BaseLibrarySchema

type EurosonicLibrary = z.infer<typeof EurosonicLibrarySchema>

const Eurosonic: EurosonicLibrary = {
  name: 'Eurosonic',
  version: '1.0.0',
  author: 'Eurosonic Ultraschall GmbH & Co. KG',
  stPath: 'resources/sources/MatIEC/lib/eurosonic.txt',
  cPath: 'resources/sources/MatIEC/lib/eurosonic.h',
  pous: [
    {
      name: 'ES_GEN_WELD',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'USON',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
          documentation: 'Maintained ultrasonic command: TRUE = on, FALSE = off (coil 1).',
        },
        {
          name: 'MODE',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '2' },
          documentation:
            'Operating mode: energy=0, time=1, external=2, profile=3, test mode=4 (40001).',
        },
        {
          name: 'TARGET_AMPLITUDE',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '62' },
          documentation: 'Target amplitude in percent (40002).',
        },
        {
          name: 'START_FREQ',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '20500' },
          documentation: 'Start frequency in Hz (40003).',
        },
        {
          name: 'STOP_FREQ',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '19500' },
          documentation: 'Stop frequency in Hz (40004).',
        },
        {
          name: 'TARGET_ENERGY',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1000' },
          documentation: 'Target energy in Ws (40005).',
        },
        {
          name: 'TARGET_TIME',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1000' },
          documentation: 'Target weld time in ms (40006).',
        },
        {
          name: 'TIME_MIN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1000' },
          documentation: 'Minimum weld time in energy mode, in ms (40007).',
        },
        {
          name: 'TIME_MAX',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1000' },
          documentation: 'Maximum weld time in energy mode, in ms (40008).',
        },
        {
          name: 'USON_STATE',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'Current state of ultrasonic command coil 1.',
        },
        {
          name: 'FREQUENCY',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Current generator frequency in Hz (30002).',
        },
        {
          name: 'POWER',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Current active power in W (30001).',
        },
        {
          name: 'ENERGY',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Energy accumulated in the current cycle, in Ws (30003).',
        },
        {
          name: 'WELD_TIME',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Time reached in the last completed cycle, in ms (30007).',
        },
        {
          name: 'RESULT_ENERGY',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Energy reached in the last completed cycle, in Ws (30006).',
        },
        {
          name: 'PHASE',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
          documentation: 'Current generator phase in degrees (30004).',
        },
        {
          name: 'LIVE_AMPLITUDE',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Current active amplitude in percent (30005).',
        },
        {
          name: 'OSCILLATION',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Current loop-quality/oscillation value (30014).',
        },
      ],
      body: '(* Implemented by the Eurosonic STM32H7 target runtime. *)',
      documentation:
        'Controls one Eurosonic generator weld cycle through its fixed Modbus process image and returns central live and result values.',
    },
  ],
}

export { Eurosonic }
