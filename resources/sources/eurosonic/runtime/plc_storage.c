#include "plc_storage.h"
#include <stddef.h>

static const plc_storage_host_t *pStorageHost;
extern int32_t plc_storage_variable(uint32_t uiIndex, plc_retain_variable_t *pVariable);

static void BindStorage(const plc_storage_host_t *pHost)
{
    pStorageHost = pHost && pHost->version == PLC_STORAGE_VERSION &&
        pHost->size == sizeof(*pHost) && pHost->submit && pHost->poll && pHost->retain_status ? pHost : NULL;
}
const plc_storage_interface_t plc_storage_interface __attribute__((section(".storage_interface_section"), used)) = {
    PLC_STORAGE_MAGIC, PLC_STORAGE_VERSION, sizeof(plc_storage_interface_t), BindStorage, plc_storage_variable
};
int plc_storage_ready(void) { return pStorageHost != NULL; }
int32_t plc_file_submit(const plc_file_request_t *pRequest, uint32_t *pTicket)
{ return pStorageHost ? pStorageHost->submit(pRequest, pTicket) : PLC_STORAGE_UNAVAILABLE; }
int32_t plc_file_poll(uint32_t uiTicket, plc_file_result_t *pResult)
{ return pStorageHost ? pStorageHost->poll(uiTicket, pResult) : PLC_STORAGE_UNAVAILABLE; }
int32_t plc_retain_status(void)
{ return pStorageHost ? pStorageHost->retain_status() : PLC_STORAGE_UNAVAILABLE; }
