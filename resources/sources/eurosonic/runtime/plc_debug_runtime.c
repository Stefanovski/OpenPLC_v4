#include "plc_debug_runtime.h"

#include <string.h>

static plc_debug_platform_t debug_platform;
static plc_debug_state_t debug_state = PLC_DEBUG_STATE_RUN;
static uint32_t current_statement_id;
static uint32_t current_pou_id;
static uint32_t current_instance_id;
static plc_debug_breakpoint_t breakpoints[PLC_DEBUG_MAX_BREAKPOINTS];
static uint16_t breakpoint_count;
static plc_debug_frame_t call_stack[PLC_DEBUG_MAX_CALL_DEPTH];
static uint16_t call_depth;
static uint16_t stored_call_depth;
static uint16_t step_depth;
static uint64_t point_count;
static uint64_t halt_count;
volatile uint32_t plc_debug_active;
volatile uint32_t plc_debug_context_active;

static plc_debug_result_t set_breakpoint_ex(const plc_debug_breakpoint_t *breakpoint);

static void update_fast_path(void)
{
    plc_debug_context_active = debug_platform.wait != 0 ? 1U : 0U;
    plc_debug_active = ((debug_platform.wait != 0) &&
                        ((breakpoint_count != 0U) ||
                         (debug_state == PLC_DEBUG_STATE_STEP_INTO) ||
                         (debug_state == PLC_DEBUG_STATE_STEP_OVER) ||
                         (debug_state == PLC_DEBUG_STATE_STEP_OUT))) ? 1U : 0U;
}

static int32_t find_breakpoint(uint32_t statement_id, uint32_t instance_id)
{
    uint16_t lower = 0U;
    uint16_t upper = breakpoint_count;
    while (lower < upper)
    {
        const uint16_t middle = (uint16_t)(lower + ((upper - lower) / 2U));
        const plc_debug_breakpoint_t *candidate = &breakpoints[middle];
        if ((candidate->statement_id < statement_id) ||
            ((candidate->statement_id == statement_id) && (candidate->instance_id < instance_id)))
            lower = (uint16_t)(middle + 1U);
        else
            upper = middle;
    }
    if ((lower < breakpoint_count) &&
        (breakpoints[lower].statement_id == statement_id) &&
        (breakpoints[lower].instance_id == instance_id)) return (int32_t)lower;
    return -((int32_t)lower + 1);
}

static uint16_t find_statement_start(uint32_t statement_id)
{
    uint16_t lower = 0U;
    uint16_t upper = breakpoint_count;
    while (lower < upper)
    {
        const uint16_t middle = (uint16_t)(lower + ((upper - lower) / 2U));
        if (breakpoints[middle].statement_id < statement_id) lower = (uint16_t)(middle + 1U);
        else upper = middle;
    }
    return lower;
}

static void bind_platform(const plc_debug_platform_t *platform)
{
    if (platform == 0)
    {
        memset(&debug_platform, 0, sizeof(debug_platform));
        debug_state = PLC_DEBUG_STATE_RUN;
        call_depth = 0U;
        stored_call_depth = 0U;
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
    plc_debug_breakpoint_t breakpoint;
    if (statement_id == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    memset(&breakpoint, 0, sizeof(breakpoint));
    breakpoint.statement_id = statement_id;
    return set_breakpoint_ex(&breakpoint);
}

static plc_debug_result_t clear_breakpoint(uint32_t statement_id)
{
    const uint16_t start = find_statement_start(statement_id);
    uint16_t end = start;
    if ((start >= breakpoint_count) || (breakpoints[start].statement_id != statement_id))
        return PLC_DEBUG_RESULT_NOT_FOUND;
    while ((end < breakpoint_count) && (breakpoints[end].statement_id == statement_id)) end += 1U;
    if (end < breakpoint_count)
        memmove(&breakpoints[start], &breakpoints[end], (breakpoint_count - end) * sizeof(breakpoints[0]));
    breakpoint_count = (uint16_t)(breakpoint_count - (end - start));
    update_fast_path();
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t set_breakpoint_ex(const plc_debug_breakpoint_t *breakpoint)
{
    int32_t position;
    if ((breakpoint == 0) || (breakpoint->statement_id == 0U)) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    if ((breakpoint->flags & PLC_DEBUG_BREAKPOINT_CONDITION) != 0U)
    {
        if ((breakpoint->condition_variable_id == 0U) ||
            (breakpoint->condition_type == PLC_DEBUG_VARIABLE_UNKNOWN) ||
            (breakpoint->condition_operator < PLC_DEBUG_CONDITION_EQUAL) ||
            (breakpoint->condition_operator > PLC_DEBUG_CONDITION_LESS_OR_EQUAL) ||
            (breakpoint->condition_size == 0U) ||
            (breakpoint->condition_size > PLC_DEBUG_MAX_BREAKPOINT_VALUE_SIZE))
            return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    }
    if ((breakpoint->flags & PLC_DEBUG_BREAKPOINT_CHANGE) != 0U)
    {
        if ((breakpoint->change_variable_id == 0U) ||
            (breakpoint->change_type == PLC_DEBUG_VARIABLE_UNKNOWN) ||
            (breakpoint->change_size == 0U) ||
            (breakpoint->change_size > PLC_DEBUG_MAX_BREAKPOINT_VALUE_SIZE))
            return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    }

    position = find_breakpoint(breakpoint->statement_id, breakpoint->instance_id);
    if (position >= 0)
    {
        breakpoints[position] = *breakpoint;
        breakpoints[position].hit_count = 0U;
        breakpoints[position].change_initialized = 0U;
        update_fast_path();
        return PLC_DEBUG_RESULT_OK;
    }
    if (breakpoint_count >= PLC_DEBUG_MAX_BREAKPOINTS) return PLC_DEBUG_RESULT_TABLE_FULL;
    position = -position - 1;
    if ((uint16_t)position < breakpoint_count)
        memmove(&breakpoints[position + 1], &breakpoints[position],
                (breakpoint_count - (uint16_t)position) * sizeof(breakpoints[0]));
    breakpoints[position] = *breakpoint;
    breakpoints[position].hit_count = 0U;
    breakpoints[position].change_initialized = 0U;
    breakpoint_count += 1U;
    update_fast_path();
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t clear_breakpoint_ex(uint32_t statement_id, uint32_t instance_id)
{
    const int32_t position = find_breakpoint(statement_id, instance_id);
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

static plc_debug_result_t step_over(void)
{
    if (debug_state != PLC_DEBUG_STATE_HALTED) return PLC_DEBUG_RESULT_INVALID_STATE;
    step_depth = call_depth;
    debug_state = PLC_DEBUG_STATE_STEP_OVER;
    update_fast_path();
    if (debug_platform.signal != 0) debug_platform.signal(debug_platform.context);
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t step_out(void)
{
    if (debug_state != PLC_DEBUG_STATE_HALTED) return PLC_DEBUG_RESULT_INVALID_STATE;
    if (call_depth <= 1U) return PLC_DEBUG_RESULT_INVALID_STATE;
    step_depth = call_depth;
    debug_state = PLC_DEBUG_STATE_STEP_OUT;
    update_fast_path();
    if (debug_platform.signal != 0) debug_platform.signal(debug_platform.context);
    return PLC_DEBUG_RESULT_OK;
}

static plc_debug_result_t get_call_stack(plc_debug_frame_t *frames, uint16_t capacity, uint16_t *count)
{
    uint16_t copy_count;
    if (count == 0) return PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    *count = stored_call_depth;
    if (frames == 0) return capacity == 0U ? PLC_DEBUG_RESULT_OK : PLC_DEBUG_RESULT_INVALID_ARGUMENT;
    copy_count = capacity < stored_call_depth ? capacity : stored_call_depth;
    if (copy_count != 0U) memcpy(frames, call_stack, copy_count * sizeof(call_stack[0]));
    return capacity < stored_call_depth ? PLC_DEBUG_RESULT_SIZE_MISMATCH : PLC_DEBUG_RESULT_OK;
}

static int compare_values(uint16_t type, const uint8_t *left, const uint8_t *right)
{
#define PLC_DEBUG_COMPARE_VALUE(c_type) do { \
    c_type left_value; c_type right_value; \
    memcpy(&left_value, left, sizeof(left_value)); \
    memcpy(&right_value, right, sizeof(right_value)); \
    return left_value < right_value ? -1 : (left_value > right_value ? 1 : 0); \
} while (0)
    switch (type)
    {
        case PLC_DEBUG_VARIABLE_BOOL:
        case PLC_DEBUG_VARIABLE_USINT:
        case PLC_DEBUG_VARIABLE_BYTE: PLC_DEBUG_COMPARE_VALUE(uint8_t);
        case PLC_DEBUG_VARIABLE_SINT: PLC_DEBUG_COMPARE_VALUE(int8_t);
        case PLC_DEBUG_VARIABLE_UINT:
        case PLC_DEBUG_VARIABLE_WORD: PLC_DEBUG_COMPARE_VALUE(uint16_t);
        case PLC_DEBUG_VARIABLE_INT: PLC_DEBUG_COMPARE_VALUE(int16_t);
        case PLC_DEBUG_VARIABLE_UDINT:
        case PLC_DEBUG_VARIABLE_DWORD: PLC_DEBUG_COMPARE_VALUE(uint32_t);
        case PLC_DEBUG_VARIABLE_DINT: PLC_DEBUG_COMPARE_VALUE(int32_t);
        case PLC_DEBUG_VARIABLE_ULINT:
        case PLC_DEBUG_VARIABLE_LWORD: PLC_DEBUG_COMPARE_VALUE(uint64_t);
        case PLC_DEBUG_VARIABLE_LINT: PLC_DEBUG_COMPARE_VALUE(int64_t);
        case PLC_DEBUG_VARIABLE_REAL: PLC_DEBUG_COMPARE_VALUE(float);
        case PLC_DEBUG_VARIABLE_LREAL: PLC_DEBUG_COMPARE_VALUE(double);
        default: return 2;
    }
#undef PLC_DEBUG_COMPARE_VALUE
}

static uint8_t condition_matches(const plc_debug_breakpoint_t *breakpoint)
{
    uint8_t value[PLC_DEBUG_MAX_BREAKPOINT_VALUE_SIZE];
    uint16_t actual_size = 0U;
    int comparison;
    if ((breakpoint->flags & PLC_DEBUG_BREAKPOINT_CONDITION) == 0U) return 1U;
    if (plc_debug_variable_read(breakpoint->condition_variable_id, breakpoint->condition_type, value,
                                sizeof(value), &actual_size, 0) != PLC_DEBUG_RESULT_OK ||
        actual_size != breakpoint->condition_size) return 0U;
    comparison = compare_values(breakpoint->condition_type, value, breakpoint->condition_value);
    switch ((plc_debug_condition_t)breakpoint->condition_operator)
    {
        case PLC_DEBUG_CONDITION_EQUAL: return comparison == 0;
        case PLC_DEBUG_CONDITION_NOT_EQUAL: return comparison != 0 && comparison != 2;
        case PLC_DEBUG_CONDITION_GREATER: return comparison > 0 && comparison != 2;
        case PLC_DEBUG_CONDITION_GREATER_OR_EQUAL: return comparison >= 0 && comparison != 2;
        case PLC_DEBUG_CONDITION_LESS: return comparison < 0;
        case PLC_DEBUG_CONDITION_LESS_OR_EQUAL: return comparison <= 0;
        default: return 0U;
    }
}

static uint8_t change_matches(plc_debug_breakpoint_t *breakpoint)
{
    uint8_t value[PLC_DEBUG_MAX_BREAKPOINT_VALUE_SIZE];
    uint16_t actual_size = 0U;
    if ((breakpoint->flags & PLC_DEBUG_BREAKPOINT_CHANGE) == 0U) return 1U;
    if (plc_debug_variable_read(breakpoint->change_variable_id, breakpoint->change_type, value,
                                sizeof(value), &actual_size, 0) != PLC_DEBUG_RESULT_OK ||
        actual_size != breakpoint->change_size) return 0U;
    if (breakpoint->change_initialized == 0U)
    {
        memcpy(breakpoint->change_value, value, actual_size);
        breakpoint->change_initialized = 1U;
        return 0U;
    }
    if (memcmp(breakpoint->change_value, value, actual_size) == 0) return 0U;
    memcpy(breakpoint->change_value, value, actual_size);
    return 1U;
}

static uint8_t breakpoint_matches(uint32_t statement_id, uint32_t instance_id)
{
    uint16_t index = find_statement_start(statement_id);
    for (; (index < breakpoint_count) && (breakpoints[index].statement_id == statement_id); index++)
    {
        plc_debug_breakpoint_t *breakpoint = &breakpoints[index];
        if ((breakpoint->statement_id != statement_id) ||
            ((breakpoint->instance_id != PLC_DEBUG_INSTANCE_NONE) &&
             (breakpoint->instance_id != instance_id))) continue;
        if (!condition_matches(breakpoint) || !change_matches(breakpoint)) continue;
        breakpoint->hit_count += 1U;
        if ((breakpoint->hit_target != 0U) && (breakpoint->hit_count < breakpoint->hit_target)) continue;
        return 1U;
    }
    return 0U;
}

void plc_debug_enter(uint32_t pou_id, uint32_t instance_id)
{
    call_depth += 1U;
    if (call_depth <= PLC_DEBUG_MAX_CALL_DEPTH)
    {
        plc_debug_frame_t *frame = &call_stack[call_depth - 1U];
        frame->pou_id = pou_id;
        frame->instance_id = instance_id == PLC_DEBUG_INSTANCE_NONE ? PLC_DEBUG_INSTANCE_NONE :
            plc_debug_instance_resolve(pou_id, (uintptr_t)instance_id);
        frame->statement_id = 0U;
        stored_call_depth = call_depth;
    }
}

void plc_debug_point(uint32_t statement_id, uint32_t pou_id, uint32_t instance_id)
{
    uint8_t keep_running;
    uint8_t should_halt;
    uint32_t effective_pou_id = pou_id;
    uint32_t effective_instance_id = instance_id;
    point_count += 1U;
    if (debug_platform.wait == 0) return;
    if ((call_depth != 0U) && (call_depth <= PLC_DEBUG_MAX_CALL_DEPTH))
    {
        plc_debug_frame_t *frame = &call_stack[call_depth - 1U];
        frame->statement_id = statement_id;
        effective_pou_id = frame->pou_id;
        effective_instance_id = frame->instance_id;
    }

    should_halt = breakpoint_matches(statement_id, effective_instance_id);
    if (debug_state == PLC_DEBUG_STATE_STEP_INTO) should_halt = 1U;
    else if ((debug_state == PLC_DEBUG_STATE_STEP_OVER) && (call_depth <= step_depth)) should_halt = 1U;
    else if ((debug_state == PLC_DEBUG_STATE_STEP_OUT) && (call_depth < step_depth)) should_halt = 1U;
    if (!should_halt) return;

    current_statement_id = statement_id;
    current_pou_id = effective_pou_id;
    current_instance_id = effective_instance_id;
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
    if (call_depth == 0U) return;
    if (call_depth <= PLC_DEBUG_MAX_CALL_DEPTH)
    {
        memset(&call_stack[call_depth - 1U], 0, sizeof(call_stack[0]));
        stored_call_depth = (uint16_t)(call_depth - 1U);
    }
    call_depth -= 1U;
}

#if defined(__GNUC__) && (!defined(PLC_DEBUG_HOST_TEST) || defined(PLC_DEBUG_HOST_VARIABLE_ADAPTER))
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

PLC_DEBUG_WEAK uint32_t plc_debug_instance_resolve(uint32_t pou_id, uintptr_t address)
{
    (void)pou_id;
    (void)address;
    return PLC_DEBUG_INSTANCE_NONE;
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
        PLC_DEBUG_CAP_VARIABLE_WRITE | PLC_DEBUG_CAP_FORCE | PLC_DEBUG_CAP_STEP_OVER |
            PLC_DEBUG_CAP_STEP_OUT | PLC_DEBUG_CAP_CALL_STACK | PLC_DEBUG_CAP_INSTANCE_BREAKPOINTS |
            PLC_DEBUG_CAP_CONDITIONAL_BREAKPOINTS | PLC_DEBUG_CAP_BREAK_ON_CHANGE | PLC_DEBUG_CAP_HIT_COUNT,
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
        step_over,
        step_out,
        get_call_stack,
        set_breakpoint_ex,
        clear_breakpoint_ex,
};
