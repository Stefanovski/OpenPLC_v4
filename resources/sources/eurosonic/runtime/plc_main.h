#ifndef PLC_MAIN_H
#define PLC_MAIN_H

// This structure is used to identify the binary file
typedef struct
{
	uint32_t uiHeaderStart;
	uint32_t uiBinaryLength;
	uint8_t aInfo[32];
	uint8_t aReserved[8];
	uint8_t aMD5[16];
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
