#ifndef PLC_FILE_H
#define PLC_FILE_H

#include "plc_storage.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    PLC_OPEN_READ = PLC_FILE_OPEN_READ,
    PLC_OPEN_WRITE = PLC_FILE_OPEN_WRITE,
    PLC_OPEN_APPEND = PLC_FILE_OPEN_APPEND
} plc_file_mode_t;

/* Zero-initialize once. Keep one object per open file or independent path
 * operation across scans. Only the wrappers may change its fields. */
typedef struct {
    uint32_t ticket;
    uint32_t operation;
    uint32_t handle;
} plc_file_t;

/* Call the same function with the same arguments on subsequent scans while
 * it returns PLC_STORAGE_BUSY. A successful call returns PLC_STORAGE_OK and
 * writes the output argument, where present. Negative values are errors.
 * Do not clear a busy context. Read/write lengths are limited to
 * PLC_FILE_BLOCK_SIZE. A successful read with zero bytes indicates EOF
 * when the requested length was nonzero. */
int32_t plc_file_open(plc_file_t *file, const char *path, plc_file_mode_t mode);
int32_t plc_file_read(plc_file_t *file, void *buffer, uint32_t length, uint32_t *bytes_read);
int32_t plc_file_write(plc_file_t *file, const void *buffer, uint32_t length, uint32_t *bytes_written);
int32_t plc_file_close(plc_file_t *file);
int32_t plc_file_rename(plc_file_t *file, const char *source, const char *destination);
int32_t plc_file_delete(plc_file_t *file, const char *path);

#ifdef __cplusplus
}
#endif

#endif
