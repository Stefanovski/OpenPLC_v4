#ifndef CONFIG_H
#define CONFIG_H

#define NUM(a) (sizeof(a) / sizeof(*a))
#define ct_assert(e) ((void)sizeof(char[1 - 2*!(e)]))

#ifndef MAX_REQUEST
	#define MAX_REQUEST           256
#endif

#ifndef MAX_RESPONSE
	#define MAX_RESPONSE          256
#endif

#ifndef HOLDING_REG_COUNT
	#define HOLDING_REG_COUNT       4096
#endif

#ifndef INPUT_REG_COUNT
	#define INPUT_REG_COUNT         4096
#endif

#ifndef COIL_COUNT
	#define COIL_COUNT              2048
#endif

#ifndef DISCRETE_COUNT
	#define DISCRETE_COUNT          2048
#endif

#ifdef MODBUS_MASTER
	#undef MODBUS_MASTER
	#define MODBUS_MASTER           1

	#ifndef SLAVE_HOLDING_REG_COUNT	
		#define SLAVE_HOLDING_REG_COUNT 16
	#endif

	#ifndef SLAVE_INPUT_REG_COUNT
		#define SLAVE_INPUT_REG_COUNT   16
	#endif

	#ifndef SLAVE_COIL_COUNT
		#define SLAVE_COIL_COUNT        16
	#endif

	#ifndef SLAVE_DISCRETE_COUNT
		#define SLAVE_DISCRETE_COUNT    16
	#endif

	#define QW_BASE                 HOLDING_REG_COUNT
	#define IW_BASE                 INPUT_REG_COUNT
	#define QX_BASE                 (COIL_COUNT / 8)
	#define IX_BASE                 (DISCRETE_COUNT / 8)

#else

	#define MODBUS_MASTER           0

	#ifdef SLAVE_HOLDING_REG_COUNT
		#undef SLAVE_HOLDING_REG_COUNT
	#endif

	#ifdef SLAVE_INPUT_REG_COUNT
		#undef SLAVE_INPUT_REG_COUNT
	#endif

	#ifdef SLAVE_COIL_COUNT
		#undef SLAVE_COIL_COUNT
	#endif

	#ifdef SLAVE_DISCRETE_COUNT
		#undef SLAVE_DISCRETE_COUNT
	#endif

#define SLAVE_HOLDING_REG_COUNT 0
#define SLAVE_INPUT_REG_COUNT   0
#define SLAVE_COIL_COUNT        0
#define SLAVE_DISCRETE_COUNT    0

#define QW_BASE                 0
#define IW_BASE                 0
#define QX_BASE                 0
#define IX_BASE                 0

#endif

#define QW_COUNT                (HOLDING_REG_COUNT + SLAVE_HOLDING_REG_COUNT)
#define IW_COUNT                (INPUT_REG_COUNT + SLAVE_INPUT_REG_COUNT)
#define QX_COUNT                (COIL_COUNT + SLAVE_COIL_COUNT)
#define IX_COUNT                (DISCRETE_COUNT + SLAVE_DISCRETE_COUNT)

#ifndef SLAVE_ADDRESS
	#define SLAVE_ADDRESS         1
#endif

#ifndef SLAVE_BAUD_RATE
	#define SLAVE_BAUD_RATE       115200
#endif

#ifndef SLAVE_PARITY
	#define SLAVE_PARITY          USART_PARITY_EVEN
#endif

#define configMODBUS_PORT       502

#endif
