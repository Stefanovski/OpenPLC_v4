#include "plc_file.h"
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

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

typedef struct {
    uint32_t uiCode;
    uint32_t uiLength;
    const char *pcPath;
    const char *pcDestination;
    const void *pWriteBuffer;
    void *pReadBuffer;
    uint32_t *pValue;
} SFileArguments;

static bool CopyPath(char acPath[PLC_FILE_PATH_SIZE], const char *pcPath)
{
    for (size_t uiIndex = 0; uiIndex < PLC_FILE_PATH_SIZE; ++uiIndex) {
        acPath[uiIndex] = pcPath[uiIndex];
        if (acPath[uiIndex] == '\0') return true;
    }
    return false;
}

static int32_t SubmitFileOperation(plc_file_t *pFile, const SFileArguments *pArguments)
{
    plc_file_request_t Request = {0};
    Request.operation = pArguments->uiCode;
    Request.handle = pFile->handle;
    Request.length = pArguments->uiLength;
    if ((pArguments->pcPath && !CopyPath(Request.path, pArguments->pcPath)) ||
        (pArguments->pcDestination && !CopyPath(Request.destination, pArguments->pcDestination)))
        return PLC_STORAGE_ARGUMENT;
    if (pArguments->pWriteBuffer && Request.length)
        memcpy(Request.data, pArguments->pWriteBuffer, Request.length);

    const int32_t iStatus = plc_file_submit(&Request, &pFile->ticket);
    if (iStatus != PLC_STORAGE_OK) return iStatus;
    pFile->operation = Request.operation;
    return PLC_STORAGE_BUSY;
}

static int32_t PollFileOperation(plc_file_t *pFile, const SFileArguments *pArguments)
{
    if (pFile->operation != pArguments->uiCode) return PLC_STORAGE_ARGUMENT;

    plc_file_result_t Result;
    const int32_t iStatus = plc_file_poll(pFile->ticket, &Result);
    if (iStatus == PLC_STORAGE_BUSY) return iStatus;
    pFile->ticket = 0;
    pFile->operation = 0;
    if (iStatus != PLC_STORAGE_OK) return iStatus;
    if (pArguments->uiCode == PLC_FILE_CLOSE) pFile->handle = 0;
    if (Result.result < 0) return Result.result;

    if (pArguments->uiCode == PLC_FILE_READ) {
        if (Result.length > pArguments->uiLength || Result.length != (uint32_t)Result.result)
            return PLC_STORAGE_IO;
        if (Result.length) memcpy(pArguments->pReadBuffer, Result.data, Result.length);
    }
    if (pArguments->pValue) *pArguments->pValue = (uint32_t)Result.result;
    return PLC_STORAGE_OK;
}

static int32_t RunFileOperation(plc_file_t *pFile, const SFileArguments *pArguments)
{
    if (!pFile || pArguments->uiLength > PLC_FILE_BLOCK_SIZE) return PLC_STORAGE_ARGUMENT;
    return pFile->ticket ? PollFileOperation(pFile, pArguments) : SubmitFileOperation(pFile, pArguments);
}

int32_t plc_file_open(plc_file_t *pFile, const char *pcPath, plc_file_mode_t Mode)
{
    if (!pFile || pFile->handle || !pcPath ||
        (Mode != PLC_OPEN_READ && Mode != PLC_OPEN_WRITE && Mode != PLC_OPEN_APPEND))
        return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = Mode, .pcPath = pcPath, .pValue = &pFile->handle});
}

int32_t plc_file_read(plc_file_t *pFile, void *pBuffer, uint32_t uiLength, uint32_t *pBytesRead)
{
    if (!pFile || !pFile->handle || (!pBuffer && uiLength) || !pBytesRead) return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = PLC_FILE_READ,
        .uiLength = uiLength, .pReadBuffer = pBuffer, .pValue = pBytesRead});
}

int32_t plc_file_write(plc_file_t *pFile, const void *pBuffer, uint32_t uiLength, uint32_t *pBytesWritten)
{
    if (!pFile || !pFile->handle || (!pBuffer && uiLength) || !pBytesWritten) return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = PLC_FILE_WRITE,
        .uiLength = uiLength, .pWriteBuffer = pBuffer, .pValue = pBytesWritten});
}

int32_t plc_file_close(plc_file_t *pFile)
{
    if (!pFile || !pFile->handle) return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = PLC_FILE_CLOSE});
}

int32_t plc_file_rename(plc_file_t *pFile, const char *pcSource, const char *pcDestination)
{
    if (!pcSource || !pcDestination) return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = PLC_FILE_RENAME,
        .pcPath = pcSource, .pcDestination = pcDestination});
}

int32_t plc_file_delete(plc_file_t *pFile, const char *pcPath)
{
    if (!pcPath) return PLC_STORAGE_ARGUMENT;
    return RunFileOperation(pFile, &(SFileArguments){.uiCode = PLC_FILE_REMOVE, .pcPath = pcPath});
}
