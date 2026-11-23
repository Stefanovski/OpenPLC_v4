#include "plc_diagnostics.h"
static uint32_t uiErrors;
void plc_iec_runtime_error(void) { __atomic_fetch_add(&uiErrors, 1U, __ATOMIC_RELAXED); }
uint32_t plc_iec_runtime_error_count(void) { return __atomic_load_n(&uiErrors, __ATOMIC_RELAXED); }
