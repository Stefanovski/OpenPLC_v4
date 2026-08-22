#ifndef PLC_DEBUG_RUNTIME_H
#define PLC_DEBUG_RUNTIME_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PLC_DEBUG_INTERFACE_MAGIC UINT32_C(0x504C4344)
#define PLC_DEBUG_INTERFACE_VERSION UINT16_C(1)
#define PLC_DEBUG_INSTANCE_NONE UINT32_C(0)
#define PLC_DEBUG_MAX_BREAKPOINTS 64U

#define PLC_DEBUG_CAP_BREAKPOINTS (UINT32_C(1) << 0)
#define PLC_DEBUG_CAP_STEP_INTO (UINT32_C(1) << 1)
#define PLC_DEBUG_CAP_VARIABLE_READ (UINT32_C(1) << 2)
#define PLC_DEBUG_CAP_VARIABLE_WRITE (UINT32_C(1) << 3)
#define PLC_DEBUG_CAP_FORCE (UINT32_C(1) << 4)

typedef enum
{
    PLC_DEBUG_STATE_RUN = 0,
    PLC_DEBUG_STATE_HALTED = 1,
    PLC_DEBUG_STATE_STEP_INTO = 2,
    PLC_DEBUG_STATE_STEP_OVER = 3,
    PLC_DEBUG_STATE_STEP_OUT = 4
} plc_debug_state_t;

typedef enum
{
    PLC_DEBUG_RESULT_OK = 0,
    PLC_DEBUG_RESULT_INVALID_ARGUMENT = 1,
    PLC_DEBUG_RESULT_NOT_FOUND = 2,
    PLC_DEBUG_RESULT_TABLE_FULL = 3,
    PLC_DEBUG_RESULT_INVALID_STATE = 4,
    PLC_DEBUG_RESULT_TYPE_MISMATCH = 5,
    PLC_DEBUG_RESULT_SIZE_MISMATCH = 6,
    PLC_DEBUG_RESULT_READ_ONLY = 7,
    PLC_DEBUG_RESULT_FORCED = 8,
    PLC_DEBUG_RESULT_UNSUPPORTED = 9,
    PLC_DEBUG_RESULT_BUSY = 10,
    PLC_DEBUG_RESULT_PROTOCOL_ERROR = 11
} plc_debug_result_t;

typedef enum
{
    PLC_DEBUG_VARIABLE_UNKNOWN = 0,
    PLC_DEBUG_VARIABLE_BOOL = 1,
    PLC_DEBUG_VARIABLE_SINT = 2,
    PLC_DEBUG_VARIABLE_USINT = 3,
    PLC_DEBUG_VARIABLE_INT = 4,
    PLC_DEBUG_VARIABLE_UINT = 5,
    PLC_DEBUG_VARIABLE_DINT = 6,
    PLC_DEBUG_VARIABLE_UDINT = 7,
    PLC_DEBUG_VARIABLE_LINT = 8,
    PLC_DEBUG_VARIABLE_ULINT = 9,
    PLC_DEBUG_VARIABLE_REAL = 10,
    PLC_DEBUG_VARIABLE_LREAL = 11,
    PLC_DEBUG_VARIABLE_TIME = 12,
    PLC_DEBUG_VARIABLE_DATE = 13,
    PLC_DEBUG_VARIABLE_TIME_OF_DAY = 14,
    PLC_DEBUG_VARIABLE_DATE_AND_TIME = 15,
    PLC_DEBUG_VARIABLE_STRING = 16,
    PLC_DEBUG_VARIABLE_BYTE = 17,
    PLC_DEBUG_VARIABLE_WORD = 18,
    PLC_DEBUG_VARIABLE_DWORD = 19,
    PLC_DEBUG_VARIABLE_LWORD = 20
} plc_debug_variable_type_t;

typedef struct
{
    uint32_t state;
    uint32_t current_statement_id;
    uint32_t current_pou_id;
    uint32_t current_instance_id;
    uint16_t breakpoint_count;
    uint16_t breakpoint_capacity;
    uint64_t point_count;
    uint64_t halt_count;
} plc_debug_status_t;

typedef uint8_t (*plc_debug_wait_callback_t)(void *context);
typedef void (*plc_debug_signal_callback_t)(void *context);

typedef struct
{
    plc_debug_wait_callback_t wait;
    plc_debug_signal_callback_t signal;
    void *context;
} plc_debug_platform_t;

typedef struct
{
    uint32_t magic;
    uint16_t version;
    uint16_t size;
    uint32_t capabilities;
    void (*bind_platform)(const plc_debug_platform_t *platform);
    plc_debug_result_t (*get_status)(plc_debug_status_t *status);
    plc_debug_result_t (*set_breakpoint)(uint32_t statement_id);
    plc_debug_result_t (*clear_breakpoint)(uint32_t statement_id);
    void (*clear_breakpoints)(void);
    plc_debug_result_t (*continue_execution)(void);
    plc_debug_result_t (*step_into)(void);
    plc_debug_result_t (*read_variable)(uint32_t id, uint16_t expected_type, void *value,
                                        uint16_t capacity, uint16_t *actual_size, uint8_t *forced);
    plc_debug_result_t (*write_variable)(uint32_t id, uint16_t expected_type, const void *value, uint16_t size);
    plc_debug_result_t (*force_variable)(uint32_t id, uint16_t expected_type, const void *value, uint16_t size);
    plc_debug_result_t (*unforce_variable)(uint32_t id);
} plc_debug_interface_v1_t;

extern const plc_debug_interface_v1_t plc_debug_interface_v1;

void plc_debug_enter(uint32_t pou_id, uint32_t instance_id);
void plc_debug_point(uint32_t statement_id, uint32_t pou_id, uint32_t instance_id);
void plc_debug_leave(uint32_t pou_id, uint32_t instance_id);

plc_debug_result_t plc_debug_variable_read(uint32_t id, uint16_t expected_type, void *value,
                                           uint16_t capacity, uint16_t *actual_size, uint8_t *forced);
plc_debug_result_t plc_debug_variable_write(uint32_t id, uint16_t expected_type, const void *value, uint16_t size);
plc_debug_result_t plc_debug_variable_force(uint32_t id, uint16_t expected_type, const void *value, uint16_t size);
plc_debug_result_t plc_debug_variable_unforce(uint32_t id);

extern volatile uint32_t plc_debug_active;

#if defined(__GNUC__)
#define PLC_DEBUG_UNLIKELY(value) __builtin_expect(!!(value), 0)
#else
#define PLC_DEBUG_UNLIKELY(value) (value)
#endif

#define PLC_DBG_ENTER(pou_id, instance_id) \
    do { if (PLC_DEBUG_UNLIKELY(plc_debug_active)) plc_debug_enter((pou_id), (instance_id)); } while (0)
#define PLC_DBG_POINT(statement_id, pou_id, instance_id) \
    do { if (PLC_DEBUG_UNLIKELY(plc_debug_active)) plc_debug_point((statement_id), (pou_id), (instance_id)); } while (0)
#define PLC_DBG_LEAVE(pou_id, instance_id) \
    do { if (PLC_DEBUG_UNLIKELY(plc_debug_active)) plc_debug_leave((pou_id), (instance_id)); } while (0)
#define PLC_DBG_EVAL(statement_id, pou_id, instance_id, expression) \
    (PLC_DEBUG_UNLIKELY(plc_debug_active) \
         ? (plc_debug_point((statement_id), (pou_id), (instance_id)), (expression)) \
         : (expression))

#ifdef __cplusplus
}
#endif

#endif
