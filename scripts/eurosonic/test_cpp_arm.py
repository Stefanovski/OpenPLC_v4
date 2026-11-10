"""Offline ARM regression. First create a fixture with eurosonic.test.ts.

Uses the production generators, runtime sources, linker layout and compiler
flags. Invokes ARM tools directly so it also works where Ninja pipe creation
is restricted. Does not flash hardware, fetch dependencies or alter Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]


def run(command, cwd):
    subprocess.run([str(arg) for arg in command], cwd=cwd, check=True, timeout=120,
                   env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})


def regenerate(root, blocks):
    fixture = root / "cpp-fixture.json"
    fixture.write_text(json.dumps({"src": str(root / "src"), "blocks": blocks}))
    run(["node", "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
         REPO / "scripts/eurosonic/write-cpp-fixture.ts", fixture], REPO)


def build(root, args, blocks, debug=False, translate=True, bridge=True):
    src = root / "src"
    xml2st = ([args.xml2st_python, args.xml2st_source] if args.xml2st_source else
              [REPO / "resources/bin/win32/x64/xml2st.exe"])
    if translate:
        if (src / "plc.xml").exists():
            run([*xml2st, "--generate-st", src / "plc.xml"], root)
        run([REPO / "resources/bin/win32/x64/iec2c.exe", "-f", "-p", "-i", "-l",
             *( ["-g"] if debug else [] ), "-I", src / "lib", "program.st"], src)
        if bridge:
            regenerate(root, blocks)
        run([*xml2st, "--generate-debug", src / "program.st", src / "VARIABLES.csv"], root)
        run([*xml2st, "--generate-gluevars", src / "LOCATED_VARIABLES.h"], root)
        import re
        md5 = re.search(r'plc_program_md5\[\] = "([a-f0-9]{32})"', (src / "debug.c").read_text())[1]
        (src / "defines.h").write_text(f'#define PROGRAM_MD5 "{md5}"\n')
        run([sys.executable, "precompile.py"], root)
    out = root / "arm-validation"
    out.mkdir(exist_ok=True)
    compiler = Path(args.toolchain) / "bin"
    include_args = [arg for path in [src, src / "lib", root / "runtime"] for arg in ["-I", path]]
    sources = sorted([*src.glob("*.c"), *src.glob("*.cpp"), * (root / "runtime").glob("*.c")])
    objects = []
    for source in sources:
        if source.name == "plc_debug_runtime.c" and not debug:
            continue
        obj = out / (source.name + ".o")
        exe = compiler / ("arm-none-eabi-g++.exe" if source.suffix == ".cpp" else "arm-none-eabi-gcc.exe")
        run([exe, "-mcpu=cortex-m7", "-mthumb", "-ffunction-sections", "-fdata-sections", "-O0", "-g",
             *( ["-DPLC_DEBUG_ENABLED=1"] if debug else [] ), *include_args, "-c", source, "-o", obj], root)
        objects.append(obj)
    if blocks:
        run([sys.executable, root / "check_cpp_objects.py", out], root)
    elf = out / "OpenPLC.elf"
    run([compiler / "arm-none-eabi-g++.exe", "-mcpu=cortex-m7", "-mthumb", "-Wl,--gc-sections",
         "-T", root / "openplc.lds", *objects, "-o", elf], root)
    binary = out / "OPEN_PLC.bin"
    run([compiler / "arm-none-eabi-objcopy.exe", "-O", "binary", elf, binary], root)
    run([sys.executable, "postcompile.py", binary, "32", "override"], root)
    data = binary.read_bytes()
    assert 1024 < len(data) <= 256 * 1024
    assert struct.unpack_from("<I", data, 8)[0] == 0xCAFEBABE
    assert struct.unpack_from("<I", data, 12)[0] == len(data) - 1024
    print(f"ARM {'debug' if debug else 'production'} PASS: {len(data)} bytes, SHA256 {hashlib.sha256(data).hexdigest()}")
    return data


def fresh_fixture(parent, label):
    root = Path(tempfile.mkdtemp(prefix=label, dir=parent))
    shutil.copytree(REPO / "resources/sources/eurosonic", root, dirs_exist_ok=True)
    shutil.copytree(REPO / "resources/sources/MatIEC/lib", root / "src/lib")
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path, help="fixture.json written by the native Jest test")
    parser.add_argument("--toolchain", default="C:/sysgcc/arm-eabi")
    parser.add_argument("--xml2st-source", help="Optional local xml2st.py when the bundled exe cannot unpack")
    parser.add_argument("--xml2st-python", default=sys.executable)
    args = parser.parse_args()
    original = json.loads(args.fixture.read_text())
    work = REPO / ".tooling"
    for debug in [False, True]:
        root = fresh_fixture(work, "cpp-arm-debug-" if debug else "cpp-arm-production-")
        shutil.copyfile(Path(original["src"]) / "plc.xml", root / "src/plc.xml")
        build(root, args, original.get("blocks", [original["block"]]), debug=debug)
    baseline = fresh_fixture(work, "cpp-arm-baseline-")
    (baseline / "src/program.st").write_text("""PROGRAM MAIN
VAR Counter : INT; END_VAR
Counter := Counter + 1;
END_PROGRAM
CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION
""")
    before = build(baseline, args, [], bridge=False)
    regenerate(baseline, [])
    after = build(baseline, args, [], translate=False)
    assert before == after, "No-C++ binary changed after generator cleanup"
    print("PASS: no-C++ binary is byte-identical before/after cleanup.")
    rejected = fresh_fixture(work, "cpp-arm-constructor-")
    source = rejected / "eurosonic_cpp_reject.cpp"
    source.write_text("volatile int state; struct Widget { Widget() { state=1; } }; Widget global;\n")
    run([Path(args.toolchain) / "bin/arm-none-eabi-g++.exe", "-mcpu=cortex-m7", "-mthumb", "-c", source,
         "-o", rejected / "eurosonic_cpp_reject.cpp.o"], rejected)
    result = subprocess.run([sys.executable, str(rejected / "check_cpp_objects.py"), str(rejected)], check=False)
    assert result.returncode == 1, "Global constructor was not rejected"
    print("PASS: unsupported global constructor rejected before linking.")


if __name__ == "__main__":
    main()
