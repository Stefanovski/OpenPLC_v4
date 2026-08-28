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
          type: { definition: 'base-type', value: 'UINT' },
          documentation:
            'Ultrasonic process state: idle=0, sweep=1, run=2, hold=3, stop=4, error=5 (30107).',
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
    {
      name: 'ES_GEN_SCAN',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'MODE',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '0' },
          documentation: 'Scan command (coil 2): 0=Off, 1=Automatic, 2=Manual. A transition to 1 or 2 starts that mode.',
        },
        {
          name: 'START_FREQ',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '20500' },
          documentation: 'Upper/start frequency of the scan in Hz (40003).',
        },
        {
          name: 'STOP_FREQ',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '19500' },
          documentation: 'Lower/stop frequency of the scan in Hz (40004).',
        },
        {
          name: 'MANUAL_FREQ',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '20500' },
          documentation: 'Frequency held while manual scan mode is active in Hz (40015).',
        },
        {
          name: 'CYCLE_DIVIDER',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1' },
          documentation: 'Cycle-skipping ratio from 1 to 256; 1 emits every pulse cycle (40016).',
        },
        {
          name: 'SETTLING_TIME_MS',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
          initialValue: { value: '1' },
          documentation: 'Settling time from 1 to 5000 ms before accepting a measurement (40017).',
        },
        {
          name: 'STATE',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation:
            'Impedance scan state (30102): 0=Idle, 1=RingDown, 2=Arming, 3=Settling, 4=Measuring, 5=Disarming, 6=Complete, 7=Error.',
        },
        {
          name: 'FP',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Parallel resonance frequency Fp of the latest valid automatic scan in Hz (30105).',
        },
        {
          name: 'FS',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
          documentation: 'Series resonance frequency Fs of the latest valid automatic scan in Hz (30106).',
        },
      ],
      body: '(* Implemented by the Eurosonic STM32H7 target runtime. *)',
      documentation:
        'Runs an automatic or manual Eurosonic impedance scan through the fixed Modbus process image and returns its state, Fp, and Fs.',
    },
  ],
}

export { Eurosonic }
