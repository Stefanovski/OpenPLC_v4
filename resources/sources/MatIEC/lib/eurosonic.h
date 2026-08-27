#ifndef EUROSONIC_FB_H
#define EUROSONIC_FB_H

#include <stddef.h>

#include "config.h"
#include "openplc.h"
#include "plc_main.h"
#include "accessor.h"

/*
 * Eurosonic blocks only access the local OpenPLC process image. The target's
 * update_inputs()/update_outputs() callbacks are the sole owners of the
 * locked D3-SRAM transfer.
 */
static inline IEC_BOOL ES_PROCESS_READ_QX(unsigned int index)
{
  IEC_BOOL *locatedValue;

  if ((index >= QX_COUNT) || (index >= MAX_DIGITAL_OUTPUT)) return 0U;

  locatedValue = bool_output[index / 8U][index % 8U];
  return locatedValue != NULL ? *locatedValue : QX[index];
}

static inline void ES_PROCESS_WRITE_QX(unsigned int index, IEC_BOOL value)
{
  IEC_BOOL **locatedValue;

  if ((index >= QX_COUNT) || (index >= MAX_DIGITAL_OUTPUT)) return;

  QX[index] = value;
  locatedValue = &bool_output[index / 8U][index % 8U];
  if (*locatedValue != NULL) {
    **locatedValue = value;
  } else {
    *locatedValue = &QX[index];
  }
}

static inline IEC_UINT ES_PROCESS_READ_IW(unsigned int index)
{
  IEC_UINT *locatedValue;

  if ((index >= IW_COUNT) || (index >= MAX_ANALOG_INPUT)) return 0U;

  locatedValue = int_input[index];
  return locatedValue != NULL ? *locatedValue : IW[index];
}

static inline void ES_PROCESS_REGISTER_IW(unsigned int index)
{
  if ((index >= IW_COUNT) || (index >= MAX_ANALOG_INPUT)) return;

  /*
   * The M7 firmware and the downloaded PLC binary have separate IW[] arrays.
   * update_inputs() transfers process data through the shared int_input[]
   * pointer table, just like an ordinary located %IW variable.  Register a
   * private shadow only when the project has not already located this index.
   */
  if (int_input[index] == NULL) {
    int_input[index] = &IW[index];
  }
}

static inline void ES_PROCESS_WRITE_QW(unsigned int index, IEC_UINT value)
{
  if ((index >= QW_COUNT) || (index >= MAX_ANALOG_OUTPUT)) return;

  QW[index] = value;
  if (int_output[index] != NULL) {
    *int_output[index] = value;
  } else {
    int_output[index] = &QW[index];
  }
}

/* Zero-based process-image positions derived from tools/parameter.json. */
enum {
  ES_DO_USON = 0,

  ES_AI_POWER = 0,
  ES_AI_FREQUENCY = 1,
  ES_AI_ENERGY = 2,
  ES_AI_PHASE = 3,
  ES_AI_LIVE_AMPLITUDE = 4,
  ES_AI_RESULT_ENERGY = 5,
  ES_AI_RESULT_TIME = 6,
  ES_AI_OSCILLATION = 13,

  ES_AO_MODE = 0,
  ES_AO_TARGET_AMPLITUDE = 1,
  ES_AO_START_FREQUENCY = 2,
  ES_AO_STOP_FREQUENCY = 3,
  ES_AO_TARGET_ENERGY = 4,
  ES_AO_TARGET_TIME = 5,
  ES_AO_TIME_MIN = 6,
  ES_AO_TIME_MAX = 7
};

typedef struct {
  __DECLARE_VAR(BOOL,EN)
  __DECLARE_VAR(BOOL,ENO)

  __DECLARE_VAR(BOOL,USON)
  __DECLARE_VAR(UINT,MODE)
  __DECLARE_VAR(UINT,TARGET_AMPLITUDE)
  __DECLARE_VAR(UINT,START_FREQ)
  __DECLARE_VAR(UINT,STOP_FREQ)
  __DECLARE_VAR(UINT,TARGET_ENERGY)
  __DECLARE_VAR(UINT,TARGET_TIME)
  __DECLARE_VAR(UINT,TIME_MIN)
  __DECLARE_VAR(UINT,TIME_MAX)

  __DECLARE_VAR(BOOL,USON_STATE)
  __DECLARE_VAR(UINT,FREQUENCY)
  __DECLARE_VAR(UINT,POWER)
  __DECLARE_VAR(UINT,ENERGY)
  __DECLARE_VAR(UINT,WELD_TIME)
  __DECLARE_VAR(UINT,RESULT_ENERGY)
  __DECLARE_VAR(INT,PHASE)
  __DECLARE_VAR(UINT,LIVE_AMPLITUDE)
  __DECLARE_VAR(UINT,OSCILLATION)
} ES_GEN_WELD;

static void ES_GEN_WELD_init__(ES_GEN_WELD *data__, BOOL retain)
{
  __INIT_VAR(data__->EN,(BOOL)1,retain)
  __INIT_VAR(data__->ENO,(BOOL)1,retain)

  __INIT_VAR(data__->USON,(BOOL)0,retain)
  __INIT_VAR(data__->MODE,2,retain)
  __INIT_VAR(data__->TARGET_AMPLITUDE,62,retain)
  __INIT_VAR(data__->START_FREQ,20500,retain)
  __INIT_VAR(data__->STOP_FREQ,19500,retain)
  __INIT_VAR(data__->TARGET_ENERGY,1000,retain)
  __INIT_VAR(data__->TARGET_TIME,1000,retain)
  __INIT_VAR(data__->TIME_MIN,1000,retain)
  __INIT_VAR(data__->TIME_MAX,1000,retain)

  __INIT_VAR(data__->USON_STATE,(BOOL)0,retain)
  __INIT_VAR(data__->FREQUENCY,0,retain)
  __INIT_VAR(data__->POWER,0,retain)
  __INIT_VAR(data__->ENERGY,0,retain)
  __INIT_VAR(data__->WELD_TIME,0,retain)
  __INIT_VAR(data__->RESULT_ENERGY,0,retain)
  __INIT_VAR(data__->PHASE,0,retain)
  __INIT_VAR(data__->LIVE_AMPLITUDE,0,retain)
  __INIT_VAR(data__->OSCILLATION,0,retain)

  ES_PROCESS_REGISTER_IW(ES_AI_POWER);
  ES_PROCESS_REGISTER_IW(ES_AI_FREQUENCY);
  ES_PROCESS_REGISTER_IW(ES_AI_ENERGY);
  ES_PROCESS_REGISTER_IW(ES_AI_PHASE);
  ES_PROCESS_REGISTER_IW(ES_AI_LIVE_AMPLITUDE);
  ES_PROCESS_REGISTER_IW(ES_AI_RESULT_ENERGY);
  ES_PROCESS_REGISTER_IW(ES_AI_RESULT_TIME);
  ES_PROCESS_REGISTER_IW(ES_AI_OSCILLATION);
}

static void ES_GEN_WELD_body__(ES_GEN_WELD *data__)
{
  const BOOL uson = __GET_VAR(data__->USON);

  if (!__GET_VAR(data__->EN)) {
    __SET_VAR(data__->,ENO,,(BOOL)0);
    return;
  }
  __SET_VAR(data__->,ENO,,(BOOL)1);

  /* An OFF request takes effect before changing the next-cycle parameters. */
  if (!uson) {
    ES_PROCESS_WRITE_QX(ES_DO_USON, 0U);
  }

  ES_PROCESS_WRITE_QW(ES_AO_MODE, (IEC_UINT)__GET_VAR(data__->MODE));
  ES_PROCESS_WRITE_QW(ES_AO_TARGET_AMPLITUDE, __GET_VAR(data__->TARGET_AMPLITUDE));
  ES_PROCESS_WRITE_QW(ES_AO_START_FREQUENCY, __GET_VAR(data__->START_FREQ));
  ES_PROCESS_WRITE_QW(ES_AO_STOP_FREQUENCY, __GET_VAR(data__->STOP_FREQ));
  ES_PROCESS_WRITE_QW(ES_AO_TARGET_ENERGY, __GET_VAR(data__->TARGET_ENERGY));
  ES_PROCESS_WRITE_QW(ES_AO_TARGET_TIME, __GET_VAR(data__->TARGET_TIME));
  ES_PROCESS_WRITE_QW(ES_AO_TIME_MIN, __GET_VAR(data__->TIME_MIN));
  ES_PROCESS_WRITE_QW(ES_AO_TIME_MAX, __GET_VAR(data__->TIME_MAX));

  /* update_outputs() transfers parameters and USON together after config_run__. */
  if (uson) {
    ES_PROCESS_WRITE_QX(ES_DO_USON, 1U);
  }

  __SET_VAR(data__->,USON_STATE,,ES_PROCESS_READ_QX(ES_DO_USON) != 0U);
  __SET_VAR(data__->,FREQUENCY,,ES_PROCESS_READ_IW(ES_AI_FREQUENCY));
  __SET_VAR(data__->,POWER,,ES_PROCESS_READ_IW(ES_AI_POWER));
  __SET_VAR(data__->,ENERGY,,ES_PROCESS_READ_IW(ES_AI_ENERGY));
  __SET_VAR(data__->,WELD_TIME,,ES_PROCESS_READ_IW(ES_AI_RESULT_TIME));
  __SET_VAR(data__->,RESULT_ENERGY,,ES_PROCESS_READ_IW(ES_AI_RESULT_ENERGY));
  __SET_VAR(data__->,PHASE,,(INT)ES_PROCESS_READ_IW(ES_AI_PHASE));
  __SET_VAR(data__->,LIVE_AMPLITUDE,,ES_PROCESS_READ_IW(ES_AI_LIVE_AMPLITUDE));
  __SET_VAR(data__->,OSCILLATION,,ES_PROCESS_READ_IW(ES_AI_OSCILLATION));
}

#endif /* EUROSONIC_FB_H */
