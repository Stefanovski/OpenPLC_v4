#ifndef PLC_TASKS_H
#define PLC_TASKS_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Versioned optional ABI shared with the M7 host. No RTOS headers in PLC code. */
#define PLC_TASKS_ADDRESS 0x081C0900U
#define PLC_TASKS_MAGIC 0x534B5450U
#define PLC_TASKS_VERSION 1U
#define PLC_TASKS_MAX 3U
#define PLC_TASKS_MAX_INTERVAL_MS 86400000U

typedef struct {
    char name[32];
    uint32_t interval_ms;
    uint32_t priority; /* IEC priority: smaller number means higher priority. */
} plc_task_descriptor_t;

typedef struct {
    uint32_t version, size;
    uint32_t (*current_task)(void);
} plc_tasks_host_t;

typedef struct {
    uint32_t magic, version, size, count;
    plc_task_descriptor_t tasks[PLC_TASKS_MAX];
    int32_t (*bind)(const plc_tasks_host_t *);
    void (*run)(uint32_t index, uint64_t elapsed_ms);
} plc_tasks_interface_t;

#ifdef __cplusplus
}
#endif
#endif
