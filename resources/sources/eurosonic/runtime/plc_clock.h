#ifndef PLC_CLOCK_H
#define PLC_CLOCK_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Shared optional ABI. Keep the M7 copy byte-identical. All values are UTC.
 * IEC DT is signed 32-bit seconds: 2000-01-01 .. 2038-01-19 03:14:07.
 * No polling, allocation or retained pointers to caller buffers. */
#define PLC_CLOCK_ADDRESS 0x081C0A00U
#define PLC_CLOCK_MAGIC 0x434C4350U
#define PLC_CLOCK_VERSION 1U
#define PLC_CLOCK_MIN_SECONDS INT32_C(946684800)
enum { PLC_CLOCK_OK = 0, PLC_CLOCK_BUSY = 1,
    PLC_CLOCK_UNAVAILABLE = -1100, PLC_CLOCK_NOT_SET = -1101,
    PLC_CLOCK_RANGE = -1102, PLC_CLOCK_IO = -1103,
    PLC_CLOCK_ARGUMENT = -1104, PLC_CLOCK_DISABLED = -1105 };

typedef struct {
    uint32_t version, size;
    int32_t (*get)(int32_t *utc_seconds);
    int32_t (*set)(int32_t utc_seconds);
} plc_clock_host_t;
typedef struct {
    uint32_t magic, version, size;
    void (*bind)(const plc_clock_host_t *host);
} plc_clock_interface_t;

/* GET leaves *utc_seconds unchanged on failure. SET changes the system RTC,
 * not PLC timers. Call SET only on an explicit event, never every scan. */
int32_t plc_get_datetime(int32_t *utc_seconds);
int32_t plc_set_datetime(int32_t utc_seconds);
#ifdef __cplusplus
}
#endif
#endif
