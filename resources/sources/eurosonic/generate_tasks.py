"""Generate the optional three-task ABI from MatIEC output, failing closed.

Single-task projects keep the original scheduler and time variable. Only build
copies are modified. No source project or external MatIEC installation is edited.
"""
from decimal import Decimal
from pathlib import Path
import re

MARKER = '\n/* EUROSONIC_TASKS_GENERATED */\n'
TIME_DECL = 'extern TIME __CURRENT_TIME;'
TIME_MULTI = '''/* EUROSONIC_TASK_TIME */
#ifdef __cplusplus
extern "C" {
#endif
TIME *plc_task_time(void);
#ifdef __cplusplus
}
#endif
#define __CURRENT_TIME (*plc_task_time())'''


def without_comments(text):
    # Inspect only IEC tokens, not C pragmas or the xml2st DBG comment catalogue.
    # Quotes and // within an IEC block comment have no lexical meaning.
    output = list(text)
    pos = 0
    while pos < len(text):
        start = pos
        if text.startswith('(*', pos):
            depth, pos = 1, pos + 2
            while depth and pos < len(text):
                if text.startswith('(*', pos):
                    depth, pos = depth + 1, pos + 2
                elif text.startswith('*)', pos):
                    depth, pos = depth - 1, pos + 2
                else:
                    pos += 1
            if depth:
                raise ValueError('Unterminated IEC comment')
        elif text.startswith('//', pos):
            end = text.find('\n', pos)
            pos = len(text) if end < 0 else end
        elif text[pos] in "'\"":
            quote, pos = text[pos], pos + 1
            while pos < len(text) and text[pos] != quote:
                pos += 2 if text[pos] == '$' else 1
            pos += 1
        elif text[pos] == '{':
            depth, pos, quote = 1, pos + 1, None
            while depth and pos < len(text):
                char = text[pos]
                if quote:
                    if char == '\\':
                        pos += 1
                    elif char == quote:
                        quote = None
                elif char in "'\"":
                    quote = char
                elif char == '{':
                    depth += 1
                elif char == '}':
                    depth -= 1
                pos += 1
            if depth:
                raise ValueError('Unterminated C pragma')
        else:
            pos += 1
            continue
        output[start:pos] = ' ' * (pos - start)
    return ''.join(output)


def interval_ms(value):
    value = re.sub(r'^(?:TIME|T)#', '', value.strip(), flags=re.I).replace('_', '')
    units = {'d': 86400000, 'h': 3600000, 'm': 60000, 's': 1000,
             'ms': 1, 'us': Decimal('.001'), 'ns': Decimal('.000001')}
    parts = list(re.finditer(r'(\d+(?:\.\d+)?)(ms|us|ns|d|h|m|s)', value, re.I))
    if not parts or ''.join(m.group() for m in parts).lower() != value.lower():
        raise ValueError('PLC task interval must be a constant IEC duration')
    total = sum(Decimal(m[1]) * units[m[2].lower()] for m in parts)
    if total != int(total) or not 1 <= total <= 86400000:
        raise ValueError('PLC task intervals must be whole milliseconds from 1 ms to 24 h')
    return int(total)


def parse_tasks(st):
    clean = without_comments(st)
    resources = re.findall(r'\bRESOURCE\s+(\w+)\s+ON\s+\w+(.*?)\bEND_RESOURCE\b', clean, re.I | re.S)
    matches = list(re.finditer(r'\bTASK\s+(\w+)\s*\((.*?)\)\s*;', clean, re.I | re.S))
    if len(matches) > 3:
        raise ValueError('Eurosonic supports at most three PLC tasks')
    if len(matches) < 2:
        return []
    if len(resources) != 1 or resources[0][0].upper() != 'RES0':
        raise ValueError('Multiple PLC tasks require the single resource Res0')
    tasks = []
    for match in matches:
        name, args = match[1], match[2]
        options = re.fullmatch(r'\s*INTERVAL\s*:=\s*(.*?)\s*,\s*PRIORITY\s*:=\s*(\d+)\s*', args, re.I | re.S)
        if not options or len(name) > 31 or int(options[2]) > 31:
            raise ValueError('Multiple PLC tasks require cyclic intervals, priorities 0..31 and names up to 31 characters')
        tasks.append((name.upper(), interval_ms(options[1]), int(options[2])))
    names = [t[0] for t in tasks]
    if len(set(names)) != len(names):
        raise ValueError('Duplicate PLC task name')
    programs = re.findall(r'\bPROGRAM\s+(\w+)\s+WITH\s+(\w+)\s*:', resources[0][1], re.I)
    if len(programs) != len(re.findall(r'\bPROGRAM\b', resources[0][1], re.I)):
        raise ValueError('Every program instance must be assigned to a PLC task')
    if len({p[0].upper() for p in programs}) != len(programs) or any(p[1].upper() not in names for p in programs):
        raise ValueError('Invalid or duplicate PLC program instance assignment')
    return tasks


def task_bodies(source, tasks):
    start = re.search(r'void\s+RES0_run__\(unsigned long tick\)\s*\{', source)
    if not start:
        raise ValueError('Unsupported MatIEC resource scheduler')
    pos, depth = start.end(), 1
    end = pos
    while depth and end < len(source):
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    if depth:
        raise ValueError('Unbalanced MatIEC scheduler')
    body = source[pos:end - 1]
    names = {t[0] for t in tasks}
    assignments = re.findall(r'\b(\w+)\s*=\s*!\(tick\s*%\s*(\d+)\);', body)
    if {n for n, _ in assignments} != names or len(assignments) != len(names):
        raise ValueError('Task metadata does not match MatIEC scheduler')
    body = re.sub(r'\b\w+\s*=\s*!\(tick\s*%\s*\d+\);', '', body)
    result = {n: [] for n in names}
    while body.strip():
        match = re.match(r'\s*if\s*\((\w+)\)\s*\{', body)
        if not match or match[1] not in names:
            raise ValueError('Unsupported MatIEC task dispatch; refusing to drop code')
        pos, depth = match.end(), 1
        end = pos
        while depth and end < len(body):
            depth += (body[end] == '{') - (body[end] == '}')
            end += 1
        if depth:
            raise ValueError('Unbalanced task body')
        result[match[1]].append(body[pos:end - 1])
        body = body[end:]
    return result


def generate(source, tasks):
    source = source.split(MARKER)[0]
    bodies = task_bodies(source, tasks)
    cases = '\n'.join(f'    case {i}: {{{"".join(bodies[t[0]])}\n        break; }}' for i, t in enumerate(tasks))
    descriptors = ',\n'.join(f'        {{"{name}", {period}U, {priority}U}}' for name, period, priority in tasks)
    return source + MARKER + f'''
#include "plc_tasks.h"
static const plc_tasks_host_t *task_host;
static TIME task_times[PLC_TASKS_MAX];
extern unsigned long __tick;
extern int plc_storage_ready(void);

/* Legacy hosts must never execute this image through the serial entry point. */
int plc_tasks_required(void) {{ return 1; }}

TIME *plc_task_time(void)
{{
    uint32_t index = task_host ? task_host->current_task() : 0U;
    return &task_times[index < {len(tasks)}U ? index : 0U];
}}

static int32_t bind_tasks(const plc_tasks_host_t *host)
{{
    task_host = 0;
    if (!host) return 0;
    if (host->version != PLC_TASKS_VERSION || host->size != sizeof(*host) || !host->current_task) return -1;
    task_host = host;
    return 0;
}}

static void run_task(uint32_t index, uint64_t elapsed_ms)
{{
    if (!task_host || !plc_storage_ready() || index >= {len(tasks)}U) return;
    task_times[index].tv_sec = (long)(elapsed_ms / 1000U);
    task_times[index].tv_nsec = (long)((elapsed_ms % 1000U) * 1000000U);
    /* Keep the legacy observation tick owned by task 0. */
    if (index == 0U) ++__tick;
    switch (index) {{
{cases}
    default: break;
    }}
}}

const plc_tasks_interface_t plc_tasks_interface __attribute__((section(".task_interface_section"), used)) = {{
    PLC_TASKS_MAGIC, PLC_TASKS_VERSION, sizeof(plc_tasks_interface_t), {len(tasks)}U,
    {{
{descriptors}
    }}, bind_tasks, run_task
}};
'''


def update_tasks(root=Path('.')):
    root = Path(root)
    tasks = parse_tasks((root / 'src/program.st').read_text(encoding='utf-8-sig'))
    resource = root / 'src/Res0.c'
    library = root / 'src/lib/iec_std_lib.h'
    glue = root / 'src/glueVars.c'
    # Also undo our build-copy adaptations when reusing a build directory.
    text = resource.read_text().split(MARKER)[0]
    lib = library.read_text().replace(TIME_MULTI, TIME_DECL)
    glue_text = glue.read_text().replace('TIME plc_legacy_time;', 'TIME __CURRENT_TIME;')
    if tasks:
        text = generate(text, tasks)
        if lib.count(TIME_DECL) != 1 or glue_text.count('TIME __CURRENT_TIME;') != 1:
            raise ValueError('Unsupported MatIEC time storage; cannot isolate PLC task clocks')
        lib = lib.replace(TIME_DECL, TIME_MULTI)
        glue_text = glue_text.replace('TIME __CURRENT_TIME;', 'TIME plc_legacy_time;')
    resource.write_text(text)
    library.write_text(lib)
    glue.write_text(glue_text)
    print(f'PLC scheduler: {len(tasks)} FreeRTOS tasks' if tasks else 'PLC scheduler: unchanged single-task path')
    if tasks:
        print('Requires M7 PLC task ABI v1. Lower IEC priority numbers run first. Shared variables/outputs need single-writer ownership.')
        if (root / 'src/program.debug.json').exists():
            print('WARNING: Statement-debug builds serialize PLC scans for coherent breakpoints; use normal compilation for timing acceptance.')


if __name__ == '__main__':
    update_tasks()
