#include "../plc_debug_runtime.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef enum
{
    TEST_CONTINUE,
    TEST_STEP_INTO,
    TEST_STEP_OVER,
    TEST_STEP_OUT
} test_action_t;

static test_action_t actions[16];
static uint16_t action_count;
static uint16_t action_index;
static uint32_t wait_count;
static int32_t condition_value;
static int32_t change_value;

static void queue_action(test_action_t action)
{
    actions[action_count++] = action;
}

static uint8_t wait_for_debug_command(void *context)
{
    plc_debug_result_t result;
    (void)context;
    assert(action_index < action_count);
    wait_count += 1U;
    switch (actions[action_index++])
    {
        case TEST_CONTINUE: result = plc_debug_interface_v1.continue_execution(); break;
        case TEST_STEP_INTO: result = plc_debug_interface_v1.step_into(); break;
        case TEST_STEP_OVER: result = plc_debug_interface_v1.step_over(); break;
        case TEST_STEP_OUT: result = plc_debug_interface_v1.step_out(); break;
        default: result = PLC_DEBUG_RESULT_INVALID_ARGUMENT; break;
    }
    assert(result == PLC_DEBUG_RESULT_OK);
    return 1U;
}

static void signal_plc_task(void *context)
{
    (void)context;
}

uint32_t plc_debug_instance_resolve(uint32_t pou_id, uintptr_t address)
{
    return (pou_id * 100U) + (uint32_t)address;
}

plc_debug_result_t plc_debug_variable_read(uint32_t id, uint16_t expected_type, void *value,
                                           uint16_t capacity, uint16_t *actual_size, uint8_t *forced)
{
    const int32_t *source;
    if (expected_type != PLC_DEBUG_VARIABLE_DINT) return PLC_DEBUG_RESULT_TYPE_MISMATCH;
    if (capacity < sizeof(*source)) return PLC_DEBUG_RESULT_SIZE_MISMATCH;
    if (id == 1U) source = &condition_value;
    else if (id == 2U) source = &change_value;
    else return PLC_DEBUG_RESULT_NOT_FOUND;
    memcpy(value, source, sizeof(*source));
    if (actual_size != 0) *actual_size = sizeof(*source);
    if (forced != 0) *forced = 0U;
    return PLC_DEBUG_RESULT_OK;
}

static void assert_call_stack(void)
{
    plc_debug_frame_t frames[PLC_DEBUG_MAX_CALL_DEPTH];
    uint16_t count = 0U;
    assert(plc_debug_interface_v1.get_call_stack(frames, PLC_DEBUG_MAX_CALL_DEPTH, &count) == PLC_DEBUG_RESULT_OK);
    assert(count == 2U);
    assert(frames[0].pou_id == 10U && frames[0].instance_id == 1001U);
    assert(frames[1].pou_id == 20U && frames[1].instance_id == 2002U);
}

int main(void)
{
    plc_debug_platform_t platform = { wait_for_debug_command, signal_plc_task, 0 };
    plc_debug_breakpoint_t breakpoint;
    const uint32_t waits_before = wait_count;

    plc_debug_interface_v1.bind_platform(&platform);
    assert(plc_debug_context_active == 1U);

    /* Instance-specific breakpoint and logical IEC stack. */
    memset(&breakpoint, 0, sizeof(breakpoint));
    breakpoint.statement_id = 200U;
    breakpoint.instance_id = 2002U;
    assert(plc_debug_interface_v1.set_breakpoint_ex(&breakpoint) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    plc_debug_enter(20U, 1U);
    plc_debug_point(200U, 20U, 0U);
    assert(wait_count == waits_before);
    plc_debug_leave(20U, 1U);
    plc_debug_enter(20U, 2U);
    plc_debug_point(200U, 20U, 0U);
    assert(wait_count == waits_before + 1U);
    assert_call_stack();
    plc_debug_leave(20U, 2U);
    plc_debug_leave(10U, 1U);
    plc_debug_interface_v1.clear_breakpoints();

    /* Step Into follows the next point into a called function block. */
    assert(plc_debug_interface_v1.set_breakpoint(150U) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_STEP_INTO);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    plc_debug_point(150U, 10U, 0U);
    plc_debug_enter(20U, 2U);
    plc_debug_point(250U, 20U, 0U);
    assert(wait_count == waits_before + 3U);
    assert_call_stack();
    plc_debug_leave(20U, 2U);
    plc_debug_leave(10U, 1U);
    plc_debug_interface_v1.clear_breakpoints();

    /* Step Over skips nested POU points and stops back at the original depth. */
    assert(plc_debug_interface_v1.set_breakpoint(100U) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_STEP_OVER);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    plc_debug_point(100U, 10U, 0U);
    plc_debug_enter(20U, 2U);
    plc_debug_point(201U, 20U, 0U);
    plc_debug_leave(20U, 2U);
    plc_debug_point(101U, 10U, 0U);
    assert(wait_count == waits_before + 5U);
    plc_debug_leave(10U, 1U);
    plc_debug_interface_v1.clear_breakpoints();

    /* Step Out stops only after returning to the caller. */
    assert(plc_debug_interface_v1.set_breakpoint(201U) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_STEP_OUT);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    plc_debug_enter(20U, 2U);
    plc_debug_point(201U, 20U, 0U);
    plc_debug_leave(20U, 2U);
    plc_debug_point(102U, 10U, 0U);
    assert(wait_count == waits_before + 7U);
    plc_debug_leave(10U, 1U);
    plc_debug_interface_v1.clear_breakpoints();

    /* Condition plus hit target. */
    memset(&breakpoint, 0, sizeof(breakpoint));
    breakpoint.statement_id = 300U;
    breakpoint.flags = PLC_DEBUG_BREAKPOINT_CONDITION;
    breakpoint.condition_variable_id = 1U;
    breakpoint.condition_type = PLC_DEBUG_VARIABLE_DINT;
    breakpoint.condition_operator = PLC_DEBUG_CONDITION_GREATER_OR_EQUAL;
    breakpoint.condition_size = sizeof(condition_value);
    condition_value = 10;
    {
        const int32_t expected = 10;
        memcpy(breakpoint.condition_value, &expected, sizeof(expected));
    }
    breakpoint.hit_target = 2U;
    assert(plc_debug_interface_v1.set_breakpoint_ex(&breakpoint) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    plc_debug_point(300U, 10U, 0U);
    plc_debug_point(300U, 10U, 0U);
    assert(wait_count == waits_before + 8U);
    plc_debug_leave(10U, 1U);
    plc_debug_interface_v1.clear_breakpoints();

    /* Break on change primes on first observation and stops on the next changed value. */
    memset(&breakpoint, 0, sizeof(breakpoint));
    breakpoint.statement_id = 400U;
    breakpoint.flags = PLC_DEBUG_BREAKPOINT_CHANGE;
    breakpoint.change_variable_id = 2U;
    breakpoint.change_type = PLC_DEBUG_VARIABLE_DINT;
    breakpoint.change_size = sizeof(change_value);
    assert(plc_debug_interface_v1.set_breakpoint_ex(&breakpoint) == PLC_DEBUG_RESULT_OK);
    queue_action(TEST_CONTINUE);
    plc_debug_enter(10U, 1U);
    change_value = 1;
    plc_debug_point(400U, 10U, 0U);
    change_value = 2;
    plc_debug_point(400U, 10U, 0U);
    assert(wait_count == waits_before + 9U);
    plc_debug_leave(10U, 1U);

    assert(action_index == action_count);
    puts("plc_debug_runtime_yellow_test: OK");
    return 0;
}
