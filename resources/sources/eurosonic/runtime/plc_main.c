#include "openplc.h"
#include <string.h>
#include <config.h>
#include <plc_main.h>
#include <debug.h>
#include "iec_std_lib.h"

extern IEC_TIME __CURRENT_TIME;
extern IEC_BOOL __DEBUG;
extern unsigned long long common_ticktime__;

extern void config_init__(void);
extern void config_run__(unsigned long tick);

IEC_BOOL IX[IX_COUNT];
IEC_BOOL QX[QX_COUNT];
IEC_UINT IW[IW_COUNT];
IEC_UINT QW[QW_COUNT];

unsigned long __tick = 0;

FlashHeader_t stFlashHeader __attribute__((section(".flash_header_section")));

// Array of function pointers
void* interface[] __attribute__((section(".interface_section"))) = {
	(void*)get_var_count,
	(void*)get_var_size,
	(void*)get_var_addr,
	(void*)force_var,
	(void*)set_trace,
	(void*)trace_reset,
	(void*)get_tick
};

void init_plc(unsigned long long *pcommon_ticktime) __attribute__((section(".init_plc_section")));
void run_plc(void(*update_inputs)(void), void(*update_outputs)(void)) __attribute__((section(".run_plc_section")));

#include <stdint.h>

// Deklariere die Symbole aus dem Linker-Skript:
extern uint32_t _sidata; // Flash-Start .data
extern uint32_t _sdata; // RAM-Start .data
extern uint32_t _edata; // RAM-Ende  .data
extern uint32_t _sbss; // RAM-Start .bss
extern uint32_t _ebss; // RAM-Ende  .bss

static void plc_data_bss_init(void)
{
	// 1. Kopiere .data aus dem Flash in den RAM
	uint32_t* src = &_sidata;
	for (uint32_t* dest = &_sdata; dest < &_edata;)
	{
		*dest++ = *src++;
	}

	// 2. Setze .bss-Speicher auf 0
	for (uint32_t* dest = &_sbss; dest < &_ebss;)
	{
		*dest++ = 0;
	}
}

//--------------------------------------------------------------------------------
// The OpenPLC handler called by the osThreadNew in main.cpp
//--------------------------------------------------------------------------------
void init_plc(unsigned long long *pcommon_ticktime)
{
#ifndef DEBUG_OPENPLC	
	// Initialize the PLC data and bss sections
	plc_data_bss_init();
#endif	
	// Clear all memory
	memset(QW, 0, QW_COUNT * sizeof(uint16_t));
	memset(IW, 0, IW_COUNT * sizeof(uint16_t));
	memset(QX, 0, QX_COUNT * sizeof(uint8_t));
	memset(IX, 0, IX_COUNT * sizeof(uint8_t));
	
	// 2. NEU: Die Hardware-Pointer zwingend auf NULL (0) setzen!
	// Da die Arrays in openplc.h bekannt sind, funktioniert sizeof() hier perfekt.
	memset(bool_input, 0, MAX_DIGITAL_INPUT  * sizeof(void*));
	memset(bool_output, 0, MAX_DIGITAL_OUTPUT * sizeof(void*));
	memset(int_input, 0, MAX_ANALOG_INPUT   * sizeof(void*));
	memset(int_output, 0, MAX_ANALOG_OUTPUT  * sizeof(void*));
	memset(int_memory, 0, MAX_MEMORY_WORD  * sizeof(void*));
	memset(dint_memory, 0, MAX_MEMORY_DWORD * sizeof(void*));
	memset(lint_memory, 0, MAX_MEMORY_LWORD * sizeof(void*));	

	config_init__();

	glueVars();

	// Set the ticktime pointer to the common_ticktime__ value
	if (pcommon_ticktime != NULL)
	{
		*pcommon_ticktime = common_ticktime__;
	}
}


//--------------------------------------------------------------------------------
// The OpenPLC handler called by the osThreadNew in main.cpp
//--------------------------------------------------------------------------------
void run_plc(void(*update_inputs)(void), void(*update_outputs)(void))
{
	// read input image
	if (update_inputs != NULL) update_inputs();
  // run the PLC
	config_run__(__tick++);
	// write output image
	if (update_outputs != NULL) update_outputs();
		
	// update the current time		
	TIME ticktime = { 0, common_ticktime__ };
	__CURRENT_TIME = __time_add(__CURRENT_TIME, ticktime);
}

