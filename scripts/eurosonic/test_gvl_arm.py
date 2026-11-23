"""Offline Cortex-M7 link of the real GVL XML/MatIEC output; no device access."""
from pathlib import Path
import argparse
import json
import tempfile
from types import SimpleNamespace

from test_cpp_arm import REPO, build, fresh_fixture, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--toolchain', required=True, help='ARM GCC toolchain root (contains bin/)')
    args = SimpleNamespace(toolchain=parser.parse_args().toolchain, xml2st_source=None, xml2st_python=None)
    with tempfile.TemporaryDirectory(prefix='gvl-arm-') as folder:
        for debug, cpp in [(False, False), (True, False), (False, True), (True, True)]:
            root = fresh_fixture(Path(folder), 'debug-' if debug else 'normal-')
            run(['node', '-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register',
                 REPO / 'scripts/eurosonic/write-gvl-fixture.ts', root / 'src', '--multi-retain', *(['--debug'] if debug else []), *(['--cpp'] if cpp else [])], REPO)
            blocks = json.loads((root / 'src/cpp-fixture.json').read_text())
            build(root, args, blocks, debug=debug)


if __name__ == '__main__':
    main()
