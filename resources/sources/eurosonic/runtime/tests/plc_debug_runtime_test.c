#include "../plc_debug_runtime.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>

static unsigned int wait_count;
static unsigned int signal_count;

static uint8_t wait_for_debug_command(void *context)
{
    plc_debug_status_t status;
    (void)context;
    assert(plc_debug_interface_v1.get_status(&status) == PLC_DEBUG_RESULT_OK);
    assert(status.state == PLC_DEBUG_STATE_HALTED);
    wait_count += 1U;
    if (wait_count == 2U)
        assert(plc_debug_interface_v1.step_into() == PLC_DEBUG_RESULT_OK);
    else
        assert(plc_debug_interface_v1.continue_execution() == PLC_DEBUG_RESULT_OK);
    return 1U;
}

static void signal_plc_task(void *context)
{
    (void)context;
    signal_count += 1U;
}

int main(void)
{
    plc_debug_platform_t platform = { wait_for_debug_command, signal_plc_task, 0 };
    plc_debug_status_t status;
    uint8_t value;

    assert(plc_debug_interface_v1.magic == PLC_DEBUG_INTERFACE_MAGIC);
    assert(plc_debug_interface_v1.version == PLC_DEBUG_INTERFACE_VERSION);
    assert(plc_debug_interface_v1.size == sizeof(plc_debug_interface_v1_t));
    plc_debug_interface_v1.bind_platform(&platform);

    assert(plc_debug_interface_v1.set_breakpoint(0U) == PLC_DEBUG_RESULT_INVALID_ARGUMENT);
    assert(plc_debug_interface_v1.set_breakpoint(200U) == PLC_DEBUG_RESULT_OK);
    assert(plc_debug_interface_v1.set_breakpoint(100U) == PLC_DEBUG_RESULT_OK);
    assert(plc_debug_interface_v1.set_breakpoint(200U) == PLC_DEBUG_RESULT_OK);

    plc_debug_point(50U, 10U, PLC_DEBUG_INSTANCE_NONE);
    assert(wait_count == 0U);

    plc_debug_point(100U, 10U, PLC_DEBUG_INSTANCE_NONE);
    assert(wait_count == 1U);
    assert(signal_count == 1U);

    plc_debug_point(200U, 10U, PLC_DEBUG_INSTANCE_NONE);
    assert(wait_count == 2U);
    assert(signal_count == 2U);

    plc_debug_point(300U, 11U, PLC_DEBUG_INSTANCE_NONE);
    assert(wait_count == 3U);
    assert(signal_count == 3U);

    assert(plc_debug_interface_v1.get_status(&status) == PLC_DEBUG_RESULT_OK);
    assert(status.state == PLC_DEBUG_STATE_RUN);
    assert(status.current_statement_id == 300U);
    assert(status.current_pou_id == 11U);
    assert(status.breakpoint_count == 2U);
    assert(status.point_count == 4U);
    assert(status.halt_count == 3U);

    assert(plc_debug_interface_v1.clear_breakpoint(100U) == PLC_DEBUG_RESULT_OK);
    assert(plc_debug_interface_v1.clear_breakpoint(100U) == PLC_DEBUG_RESULT_NOT_FOUND);
    plc_debug_interface_v1.clear_breakpoints();
    assert(plc_debug_interface_v1.get_status(&status) == PLC_DEBUG_RESULT_OK);
    assert(status.breakpoint_count == 0U);

    assert(plc_debug_interface_v1.read_variable(1U, PLC_DEBUG_VARIABLE_BOOL, &value, sizeof(value), 0, 0) ==
           PLC_DEBUG_RESULT_UNSUPPORTED);

    puts("plc_debug_runtime_test: OK");
    return 0;
}
