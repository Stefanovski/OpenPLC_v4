#include <HAL.h>
#include <string.h>
#include "config.h"
#include "plc_main.h"
#include "iec_types_all.h"

#include "hw.h"
#include "openplc.h"

//-----------------------------------------------------------------------------
// STN: PROCESSDATA
//-----------------------------------------------------------------------------

//-----------------------------------------------------------------------------
// Collect all inputs and update the internal buffer IX that points to the 
// modbus_di array. This function is called by the OpenPLC in a loop.
//-----------------------------------------------------------------------------
void update_inputs(void)
{
	// In the original generator this reads all inputs from the FPGA (Memory)
}

//-----------------------------------------------------------------------------
// Write all outputs based on the internal buffer QX that points to the modbus_do
// array. This function is called by the OpenPLC in a loop.
//-----------------------------------------------------------------------------
void update_outputs(void)
{
	// In the original generator this writes all outputs to the FPGA (Memory)
}

//-----------------------------------------------------------------------------
// Disable all outputs. This function is called by the OpenPLC when the PLC is
// stopped.
//-----------------------------------------------------------------------------
static void disable_outputs(void)
{
	// In the original generator this writes all outputs to the FPGA (Memory)
}



