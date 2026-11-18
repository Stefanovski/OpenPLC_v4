"""Derive RETAIN descriptors from the compiler's existing variable catalogue.

No second IEC parser: debug.c already resolves global, nested FB and located
symbols. Runtime IEC retain flags select the persisted values after config_init.
"""
import re
import hashlib
from pathlib import Path

MARKER = '/* GEN2_STORAGE_DESCRIPTORS */'


def generate(source):
    source = source.split(MARKER)[0].rstrip() + '\n'
    table = re.search(r'\bdebug_vars\[\]\s*=\s*\{(.*?)\n\};', source, re.S)
    if not table:
        raise ValueError('Missing compiler debug_vars catalogue; refusing incomplete RETAIN support')
    entries = re.findall(r'\{\s*&\(([^\n]+?)\)\s*,\s*(\w+_ENUM)\s*\}', table[1])
    count = re.search(r'#define\s+VAR_COUNT\s+(\d+)', source)
    if not count or int(count[1]) != len(entries):
        raise ValueError('Unsupported variable catalogue format/count')
    lines = [MARKER, '#include "plc_storage.h"',
             'int32_t plc_storage_variable(uint32_t uiIndex, plc_retain_variable_t *pVariable)',
             '{', '    if (!pVariable) return -1;', '    switch (uiIndex) {']
    # MatIEC flattens arrays/structures into raw leaves in debug_vars. Their
    # RETAIN flag belongs to the enclosing IEC wrapper, not to each raw leaf.
    groups = {}
    for expression, kind in entries:
        root = expression.split('.value.', 1)[0]
        groups.setdefault(root, []).append((expression, kind))
    for index, (expression, leaves) in enumerate(groups.items()):
        kind = leaves[0][1]
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.\[\]]*', expression):
            raise ValueError('Unsupported variable expression: ' + expression)
        aggregate = leaves[0][0] != expression
        pointer = not aggregate and kind.endswith(('_P_ENUM', '_O_ENUM'))
        signature = kind if not aggregate else 'aggregate:' + hashlib.sha256(repr(leaves).encode()).hexdigest()
        value = f'({expression}).value'
        data = value if pointer else '&' + value
        size = f'sizeof(*{value})' if pointer else f'sizeof({value})'
        lines += [f'    case {index}:', f'        pVariable->name = "{expression}";',
                  f'        pVariable->type = "{signature}";', f'        pVariable->data = (void*)({data});',
                  f'        pVariable->size = (({expression}).flags & __IEC_RETAIN_FLAG) ? {size} : 0;',
                  '        return 1;']
    lines += ['    default: return 0;', '    }', '}', '']
    return source + '\n'.join(lines)


def update_storage():
    path = Path('src/debug.c')
    path.write_text(generate(path.read_text()))


if __name__ == '__main__':
    update_storage()
