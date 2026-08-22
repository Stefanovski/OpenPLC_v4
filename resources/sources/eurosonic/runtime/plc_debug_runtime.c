#include "plc_debug_runtime.h"

#include <string.h>

static plc_debug_platform_t debug_platform;
static plc_debug_state_t debug_state = PLC_DEBUG_STATE_RUN;
static uint32_t current_statement_id;
static uint32_t current_pou_id;
static uint32_t current_instance_id;
static uint32_t breakpoints[PLC_DEBUG_MAX_BREAKPOINTS];
static uint16_t breakpoint_count;
static uint64_t point_count;
static uint64_t halt_count;
volatile uint32_t plc_debug_active;

static void update_fast_path(void)
{
    plc_debug_active = ((debug_platform.wait != 0) &&
                        ((breakpoint_count != 0U) || (debug_state == PLC_DEBUG_STATE_STEP_INTO))) ? 1U : 0U;
}

static int32_t find_breakpoint(uint32_t statement_id)
{
    uint16_t low = 0;
    uint16_t high = breakpoint_count;
    while (low < high)
    {
        const uint16_t middle = (uint16_t)(low + ((high - low) / 2U));
        if (breakpoints[middle] == statement_id) return (int32_t)middle;
        if (breakpoints[middle] < statement_id) low = (uint16_t)(middle + 1U);
        else high = middle;
    }
    return -((int32_t)low + 1);
}

static void bind_platform(const plc_debug_platform_t *platform)
{
    if (platform == 0)
    {
        memset(&debug_platform, 0, sizeof(debug_platform));
        debug_state = PLC_DEBUG_STATE_RUN;
        update_fast_path();
        return;
    }
    debug_platform = *platform;
    update_fast_path();
}

static plc_debug_result_t get_status(plc_debug_status_t *status)
{
    if (status == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    status->state = (uint32_t)debug_state;
    status->current_statement_id = current_statement_id;
    status->current_pou_id = current_pou_id;
    status->current_instance_id = current_instance_id;
    status->breakpoint_count = breakpoint_count;
    status->breakpoint_capacity = PLC_DEBUG_MAX_BREAKPOINTS;
    status->point_count = point_count;
    status->halt_count = halt_count;
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t set_breakpoint(uint32_t statement_id)
{
    int32_t position;
    uint16_t insertion;
    if (statement_id == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    position = find_breakpoint(statement_id);
    if (position >= 0) return PLC_DEBUG_RESULT_OK;
    if (breakpoint_count >= PLC_DEBUG_MAX_BREAKPOINTS) return PLC_DEBUG_RESULT_TABLE_FULL;
    insertion = (uint16_t)(-position - 1);
    if (insertion < breakpoint_count)
    {
        memmove(&breakpoints[insertion + 1U], &breakpoints[insertion],
                (breakpoint_count - insertion) * sizeof(breakpoints[0]));
    }
    breakpoints[insertion] = statement_id;
    breakpoint_count += 1U;
    update_fast_path();
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t clear_breakpoint(uint32_t statement_id)
{
    const int32_t position = find_breakpoint(statement_id);
    if (position < 0) return PLC_DEBUG_RESULT_NOT_FOUND;
    if ((uint16_t)position + 1U < breakpoint_count)
    {
        memmove(&breakpoints[position], &breakpoints[position + 1],
                (breakpoint_count - (uint16_t)position - 1U) * sizeof(breakpoints[0]));
    }
    breakpoint_count -= 1U;
    update_fast_path();
    return PLC_DEBUG_RESULT_OK;
}

static void clear_breakpoints(void)
{
    breakpoint_count = 0;
    update_fast_path();
}

static plc_debug_result_t continue_execution(void)
{
    if (debug_state != PLC_DEBUG_STATE_HALTED) return PLC_DEBUG_RESULT_INVALID_STATE;
    debug_state = PLC_DEBUG_STATE_RUN;
    update_fast_path();
    if (debug_platform.signal != 0) debug_platform.signal(debug_platform.context);
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t step_into(void)
{
    if (debug_state != PLC_DEBUG_STATE_HALTED) return PLC_DEBUG_RESULT_INVALID_STATE;
    debug_state = PLC_DEBUG_STATE_STEP_INTO;
    update_fast_path();
    if (debug_platform.signal != 0) debug_platform.signal(debug_platform.context);
    return PLC_DEBUG_RESULT_OK;
}

void plc_debug_enter(uint32_t pou_id, uint32_t instance_id)
{
    (void)pou_id;
    (void)instance_id;
}

void plc_debug_point(uint32_t statement_id, uint32_t pou_id, uint32_t instance_id)
{
    uint8_t keep_running;
    point_count += 1U;
    if (debug_platform.wait == 0) return;
    if ((debug_state != PLC_DEBUG_STATE_STEP_INTO) && (find_breakpoint(statement_id) < 0)) return;

    current_statement_id = statement_id;
    current_pou_id = pou_id;
    current_instance_id = instance_id;
    debug_state = PLC_DEBUG_STATE_HALTED;
    halt_count += 1U;

    do
    {
        keep_running = debug_platform.wait(debug_platform.context);
        if (!keep_running)
        {
            debug_state = PLC_DEBUG_STATE_RUN;
            update_fast_path();
        }
    } while (debug_state == PLC_DEBUG_STATE_HALTED);
}

void plc_debug_leave(uint32_t pou_id, uint32_t instance_id)
{
    (void)pou_id;
    (void)instance_id;
}

#if defined(__GNUC__) && !defined(PLC_DEBUG_HOST_TEST)
#define PLC_DEBUG_WEAK __attribute__((weak))
#else
#define PLC_DEBUG_WEAK
#endif

PLC_DEBUG_WEAK plc_debug_result_t plc_debug_variable_read(uint32_t id, uint16_t expected_type, void *value,
                                                          uint16_t capacity, uint16_t *actual_size, uint8_t *forced)
{
    (void)id;
    (void)expected_type;
    (void)value;
    (void)capacity;
    (void)actual_size;
    (void)forced;
    return PLC_DEBUG_RESULT_UNSUPPORTED;
}

PLC_DEBUG_WEAK plc_debug_result_t plc_debug_variable_write(uint32_t id, uint16_t expected_type,
                                                           const void *value, uint16_t size)
{
    (void)id;
    (void)expected_type;
    (void)value;
    (void)size;
    return PLC_DEBUG_RESULT_UNSUPPORTED;
}

PLC_DEBUG_WEAK plc_debug_result_t plc_debug_variable_force(uint32_t id, uint16_t expected_type,
                                                           const void *value, uint16_t size)
{
    (void)id;
    (void)expected_type;
    (void)value;
    (void)size;
    return PLC_DEBUG_RESULT_UNSUPPORTED;
}

PLC_DEBUG_WEAK plc_debug_result_t plc_debug_variable_unforce(uint32_t id)
{
    (void)id;
    return PLC_DEBUG_RESULT_UNSUPPORTED;
}

#if defined(__GNUC__) && !defined(PLC_DEBUG_HOST_TEST)
#define PLC_DEBUG_INTERFACE_ATTRIBUTE __attribute__((section(".debug_interface_section"), used))
#else
#define PLC_DEBUG_INTERFACE_ATTRIBUTE
#endif

const plc_debug_interface_v1_t plc_debug_interface_v1 PLC_DEBUG_INTERFACE_ATTRIBUTE = {
        PLC_DEBUG_INTERFACE_MAGIC,
        PLC_DEBUG_INTERFACE_VERSION,
        sizeof(plc_debug_interface_v1_t),
        PLC_DEBUG_CAP_BREAKPOINTS | PLC_DEBUG_CAP_STEP_INTO | PLC_DEBUG_CAP_VARIABLE_READ |
            PLC_DEBUG_CAP_VARIABLE_WRITE | PLC_DEBUG_CAP_FORCE,
        bind_platform,
        get_status,
        set_breakpoint,
        clear_breakpoint,
        clear_breakpoints,
        continue_execution,
        step_into,
        plc_debug_variable_read,
        plc_debug_variable_write,
        plc_debug_variable_force,
        plc_debug_variable_unforce,
};
