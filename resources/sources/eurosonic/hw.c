#include <HAL.h>
#include <string.h>
#include "config.h"
#include "plc_main.h"
#include "iec_types_all.h"

#include "hw.h"
#include "openplc.h"

//-----------------------------------------------------------------------------
// Collect all inputs and update the internal buffer IX that points to the 
// modbus_di array. This function is called by the OpenPLC in a loop.
//-----------------------------------------------------------------------------
void update_inputs(void)
{
	// In the original generator this reads all inputs from the FPGA (Memory)
	
	// For Testing purposes we will read the inputs from the GPIOs
	IX[0] = (HAL_GPIO_ReadPin(GPIOI, GPIO_PIN_12) > 0) ? IX[0] | 0x01 : IX[0] & 0xFE;
	*bool_input[0][0] = IX[0];
}

//-----------------------------------------------------------------------------
// Write all outputs based on the internal buffer QX that points to the modbus_do
// array. This function is called by the OpenPLC in a loop.
//-----------------------------------------------------------------------------
void update_outputs(void)
{
	// In the original generator this writes all outputs to the FPGA (Memory)

	// For Testing purposes we will write the outputs to the GPIOs
	QX[0] = *bool_output[0][0];
	HAL_GPIO_WritePin(GPIOI, GPIO_PIN_13, QX[0] & 0x01);
}

//-----------------------------------------------------------------------------
// Disable all outputs. This function is called by the OpenPLC when the PLC is
// stopped.
//-----------------------------------------------------------------------------
static void disable_outputs(void)
{
	// In the original generator this writes all outputs to the FPGA (Memory)
	HAL_GPIO_WritePin(GPIOI, GPIO_PIN_13, 0x00);
}



