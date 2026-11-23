#include "plc_clock.h"
#include <stddef.h>

static const plc_clock_host_t *pClockHost;
static void BindClock(const plc_clock_host_t *pHost)
{
    pClockHost = pHost && pHost->version == PLC_CLOCK_VERSION &&
        pHost->size == sizeof(*pHost) && pHost->get && pHost->set ? pHost : NULL;
}
const plc_clock_interface_t plc_clock_interface __attribute__((section(".clock_interface_section"), used)) = {
    PLC_CLOCK_MAGIC, PLC_CLOCK_VERSION, sizeof(plc_clock_interface_t), BindClock
};
int32_t plc_get_datetime(int32_t *pSeconds)
{
    int32_t iSeconds = 0, iStatus;
    if (!pSeconds) return PLC_CLOCK_ARGUMENT;
    if (!pClockHost) return PLC_CLOCK_UNAVAILABLE;
    iStatus = pClockHost->get(&iSeconds);
    if (iStatus == PLC_CLOCK_OK) {
        if (iSeconds < PLC_CLOCK_MIN_SECONDS) return PLC_CLOCK_RANGE;
        *pSeconds = iSeconds;
    }
    return iStatus;
}
int32_t plc_set_datetime(int32_t iSeconds)
{
    if (iSeconds < PLC_CLOCK_MIN_SECONDS) return PLC_CLOCK_RANGE;
    return pClockHost ? pClockHost->set(iSeconds) : PLC_CLOCK_UNAVAILABLE;
}
