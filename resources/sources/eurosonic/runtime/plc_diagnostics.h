#ifndef PLC_DIAGNOSTICS_H
#define PLC_DIAGNOSTICS_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Bare-metal replacement for MatIEC's stderr error notification. No heap,
 * syscalls or wait in the PLC scan. Counter resets at PLC initialization. */
void plc_iec_runtime_error(void);
uint32_t plc_iec_runtime_error_count(void);
#ifdef __cplusplus
}
#endif
#endif
