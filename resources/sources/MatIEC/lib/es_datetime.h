#ifndef ES_DATETIME_H
#define ES_DATETIME_H
#include <stddef.h>
#include "iec_types.h"
#include "plc_clock.h"

/* MatIEC supplies EN/ENO. Defaults allow ES_GET_DATETIME() in C++ as well.
 * Optional output parameters avoid a global last-error shared by PLC tasks. */
#ifdef __cplusplus
#define ES_CLOCK_DEFAULT(value) = value
#else
#define ES_CLOCK_DEFAULT(value)
#endif
static inline IEC_DT ES_GET_DATETIME(IEC_BOOL EN ES_CLOCK_DEFAULT(1),
    IEC_BOOL *ENO ES_CLOCK_DEFAULT(NULL), IEC_BOOL *VALID ES_CLOCK_DEFAULT(NULL),
    IEC_DINT *STATUS ES_CLOCK_DEFAULT(NULL))
{
    IEC_DT Result = {0, 0};
    const int32_t iStatus = EN ? plc_get_datetime(&Result.tv_sec) : PLC_CLOCK_DISABLED;
    if (VALID) *VALID = iStatus == PLC_CLOCK_OK;
    if (STATUS) *STATUS = iStatus;
    if (ENO) *ENO = iStatus == PLC_CLOCK_OK;
    return Result;
}
static inline IEC_DINT ES_SET_DATETIME(IEC_BOOL EN, IEC_BOOL *ENO, IEC_DT UTC)
{
    const int32_t iStatus = !EN ? PLC_CLOCK_DISABLED : UTC.tv_nsec != 0 ? PLC_CLOCK_RANGE :
        plc_set_datetime(UTC.tv_sec);
    if (ENO) *ENO = iStatus == PLC_CLOCK_OK;
    return iStatus;
}
#ifdef __cplusplus
static inline IEC_DINT ES_SET_DATETIME(IEC_DT UTC) { return ES_SET_DATETIME(1, NULL, UTC); }
#endif
#undef ES_CLOCK_DEFAULT
#endif
