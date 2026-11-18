#ifndef PLC_STORAGE_H
#define PLC_STORAGE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Shared C ABI. Keep the OpenPLC runtime copy byte-identical. */
#define PLC_STORAGE_ADDRESS 0x081C0800U
#define PLC_STORAGE_MAGIC 0x53544350U
#define PLC_STORAGE_VERSION 1U
#define PLC_RETAIN_CAPACITY 704U
#define PLC_RETAIN_VARIABLES 128U
#define PLC_FILE_BLOCK_SIZE 256U
#define PLC_FILE_PATH_SIZE 96U

enum { PLC_STORAGE_OK = 0, PLC_STORAGE_BUSY = 1, PLC_STORAGE_DEFAULTS = 2,
    PLC_STORAGE_LAYOUT_CHANGED = 3, PLC_STORAGE_UNAVAILABLE = -1000,
    PLC_STORAGE_ARGUMENT = -1001, PLC_STORAGE_CAPACITY = -1002,
    PLC_STORAGE_IO = -1003, PLC_STORAGE_STALE = -1004 };
enum { PLC_FILE_OPEN_READ = 1, PLC_FILE_OPEN_WRITE, PLC_FILE_OPEN_APPEND,
    PLC_FILE_READ, PLC_FILE_WRITE, PLC_FILE_SEEK, PLC_FILE_SYNC, PLC_FILE_CLOSE,
    PLC_FILE_RENAME, PLC_FILE_REMOVE };

typedef struct {
    const char *name;
    const char *type;
    void *data;
    uint32_t size; /* Zero for NON_RETAIN entries. */
} plc_retain_variable_t;

/* One outstanding file operation, two open handles, bounded owned buffers.
 * Submit returns BUSY without waiting; do not retry a successful submit.
 * Poll consumes a completed result. Negative result values include LittleFS errors.
 * Read EOF is result=0; write/read result is the transferred byte count.
 * OPEN result is a handle; SEEK uses an absolute byte offset.
 */
typedef struct {
    uint32_t operation, handle, length, offset;
    char path[PLC_FILE_PATH_SIZE], destination[PLC_FILE_PATH_SIZE];
    uint8_t data[PLC_FILE_BLOCK_SIZE];
} plc_file_request_t;
typedef struct {
    int32_t result;
    uint32_t length;
    uint8_t data[PLC_FILE_BLOCK_SIZE];
} plc_file_result_t;
typedef struct {
    uint32_t version, size;
    int32_t (*submit)(const plc_file_request_t *, uint32_t *);
    int32_t (*poll)(uint32_t, plc_file_result_t *);
    int32_t (*retain_status)(void);
} plc_storage_host_t;
typedef struct {
    uint32_t magic, version, size;
    void (*bind)(const plc_storage_host_t *);
    int32_t (*variable)(uint32_t, plc_retain_variable_t *); /* 1 entry, 0 end, <0 error */
} plc_storage_interface_t;

int32_t plc_file_submit(const plc_file_request_t *request, uint32_t *ticket);
int32_t plc_file_poll(uint32_t ticket, plc_file_result_t *result);
/* OK means the last captured checkpoint has two verified FRAM copies.
 * BUSY means a checkpoint is pending. No I2C operation is performed here. */
int32_t plc_retain_status(void);
#ifdef __cplusplus
}
#endif
#endif
