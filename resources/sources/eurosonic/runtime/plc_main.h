#ifndef PLC_MAIN_H
#define PLC_MAIN_H

#include <iec_types_all.h>


extern IEC_BOOL IX[];
extern IEC_BOOL QX[];
extern IEC_UINT IW[];
extern IEC_UINT QW[];


// This structure is shared with the M7 loader. Keep its layout in sync with
// FlashHeader_t in ESSTM_H7_M7/src/openplc/runtime/plc_main.h.
typedef struct
{
	uint8_t estack_reset[8];
	uint32_t uiHeader;
	uint32_t uiLength;
	uint8_t aInfo[32];
	uint8_t aMD5[16];
	uint8_t uiState;
	uint8_t plcMD5[32];
	uint8_t aReserved[927];
} FlashHeader_t;

typedef enum {
	func_get_var_count,
	func_get_var_size,
	func_get_var_addr,
	func_force_var,
	func_set_trace,
	func_trace_reset,
	func_get_tick,
	FUNC_COUNT // Total number of functions
} FunctionIndex_t;

void init_plc(unsigned long long *pcommon_ticktime);
void run_plc(void(*update_inputs)(void), void(*update_outputs)(void));

#endif // PLC_MAIN_H
