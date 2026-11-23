"""Offline ARM regression for project static libraries (libs/*.a).

Builds a baseline PLC tree with the production generators, runtime, linker
script and CMakeLists.txt, then links small ARM fixture libraries through the
same CMake/Ninja flow as build.bat. Covers: circular libraries (link group),
symbol and data placement in the PLC window, a replaced library, and the
negative cases (hard-float ABI, unresolved symbol, image too large).
Does not flash hardware, fetch dependencies or alter Git.

    python scripts/eurosonic/test_libs_arm.py --toolchain C:/sysgcc/arm-eabi --ninja C:/tools/ninja \
        [--original-cmake CMakeLists.txt.before]

--original-cmake is the CMakeLists.txt from before the libs change; it enables the check that a
project without libs/ produces a byte-identical OPEN_PLC.bin.
"""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "resources/sources/eurosonic"
ST = """PROGRAM MAIN
VAR Counter : INT; END_VAR
Counter := Counter + 1;
END_PROGRAM
CONFIGURATION Config0
RESOURCE Res0 ON PLC
TASK task0(INTERVAL := T#20ms, PRIORITY := 0);
PROGRAM instance0 WITH task0 : MAIN;
END_RESOURCE
END_CONFIGURATION
"""
LIBA = """#include <stdint.h>
int32_t z_helper(int32_t);
int32_t a_helper(int32_t v) { return v * 3; }
int32_t g_counter = 7;
int32_t g_zero[16];
int32_t fix_add(int32_t a, int32_t b) { g_zero[a & 15] += b; g_counter++; return z_helper(a) + b + g_counter; }
"""
LIBZ = "#include <stdint.h>\nint32_t a_helper(int32_t);\nint32_t z_helper(int32_t v) { return a_helper(v) + 1; }\n"
BIG = "#include <stdint.h>\nconst uint8_t big_table[300 * 1024] = {1};\nint32_t big_use(int32_t i) { return big_table[i]; }\n"
STUBS = "void _exit(int s){for(;;);}\nint _kill(int p,int s){return -1;}\nint _getpid(void){return 1;}\n"
CALL = 'extern "C" int {fn}(int, int); extern "C" __attribute__((section(".run_plc_section"), used)) int user_call(int a) {{ return {fn}(a, 1); }}\n'


def run(cmd, cwd, env=None, check=True):
    result = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, capture_output=True, text=True, timeout=300)
    if check and result.returncode:
        sys.exit(f"FAILED: {cmd}\n{result.stdout}\n{result.stderr}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--toolchain", default="C:/sysgcc/arm-eabi")
    parser.add_argument("--ninja", help="Folder with ninja.exe if it is not on PATH")
    parser.add_argument("--original-cmake", type=Path)
    args = parser.parse_args()
    tool = Path(args.toolchain) / "bin"
    env = {**os.environ, "PATH": os.pathsep.join(filter(None, [str(tool), args.ninja, os.environ["PATH"]])),
           "PYTHONDONTWRITEBYTECODE": "1"}
    # Keep the tree short: the ARM toolchain on Windows rejects paths over 260 characters.
    work = Path(tempfile.mkdtemp(prefix="plc", dir=os.environ.get("PLC_TEST_TMP")))
    try:
        base = work / "base"
        shutil.copytree(SRC, base)
        shutil.copytree(REPO / "resources/sources/MatIEC/lib", base / "src/lib")
        (base / "src/program.st").write_text(ST)
        xml2st = REPO / "resources/bin/win32/x64/xml2st.exe"
        run([REPO / "resources/bin/win32/x64/iec2c.exe", "-f", "-p", "-i", "-l", "-I", base / "src/lib", "program.st"],
            base / "src")
        run([xml2st, "--generate-debug", base / "src/program.st", base / "src/VARIABLES.csv"], base)
        run([xml2st, "--generate-gluevars", base / "src/LOCATED_VARIABLES.h"], base)
        md5 = re.search(r'plc_program_md5\[\] = "([a-f0-9]{32})"', (base / "src/debug.c").read_text())[1]
        (base / "src/defines.h").write_text(f'#define PROGRAM_MD5 "{md5}"\n')
        run([sys.executable, "precompile.py"], base, env)
        toolchain = (base / "toolchain.cmake").read_text().replace("C:/sysgcc/arm-eabi", Path(args.toolchain).as_posix())
        (base / "toolchain.cmake").write_text(toolchain)
        (base / "src/stubs.c").write_text(STUBS)  # newlib syscalls some toolchains do not provide

        fixtures = work / "fx"
        fixtures.mkdir()
        for name, code in {"liba": LIBA, "liba2": LIBA.replace("v * 3", "v * 5"), "libz": LIBZ, "big": BIG}.items():
            (fixtures / f"{name}.c").write_text(code)
            run([tool / "arm-none-eabi-gcc.exe", "-mcpu=cortex-m7", "-mthumb", "-O1", "-ffunction-sections",
                 "-fdata-sections", "-c", f"{name}.c", "-o", f"{name}.o"], fixtures)
            run([tool / "arm-none-eabi-ar.exe", "rcs", f"{name}.a", f"{name}.o"], fixtures)
        run([tool / "arm-none-eabi-gcc.exe", "-mcpu=cortex-m7", "-mthumb", "-mfloat-abi=hard", "-mfpu=fpv5-d16", "-O1",
             "-c", "liba.c", "-o", "hard.o"], fixtures)
        run([tool / "arm-none-eabi-ar.exe", "rcs", "hard.a", "hard.o"], fixtures)

        def build(name, libs, fn="fix_add", cmake=None):
            tree = work / name
            shutil.copytree(base, tree)
            if cmake:
                shutil.copyfile(cmake, tree / "CMakeLists.txt")
            if libs is not None:
                (tree / "libs").mkdir()
                (tree / "libs/readme.txt").write_text("not a library")
                for lib in libs:  # "source:name" copies a fixture under another name
                    source, _, target = lib.partition(":")
                    shutil.copyfile(fixtures / source, tree / "libs" / (target or source))
                if libs:
                    (tree / "src/user.cpp").write_text(CALL.format(fn=fn))
            run(["cmake", "-G", "Ninja", "-B", "build", "-DCMAKE_TOOLCHAIN_FILE=toolchain.cmake",
                 "-DCMAKE_BUILD_TYPE=Debug", "."], tree, env)
            result = run(["cmake", "--build", "build"], tree, env, check=False)
            if result.returncode:
                return None, result.stdout + result.stderr, tree
            run([sys.executable, "postcompile.py", "build/output/OPEN_PLC.bin", "32", "override"], tree, env)
            return (tree / "build/output/OPEN_PLC.bin").read_bytes(), result.stdout + result.stderr, tree

        # Positive: circular libraries need the link group; headers/readme are ignored.
        image, _, tree = build("ok", ["liba.a", "libz.a"])
        assert image, "libs build failed"
        text = (tree / "build/OpenPLC.map").read_text()
        for symbol, low in (("fix_add", 0x081C0000), ("z_helper", 0x081C0000), ("g_counter", 0x24060000)):
            address = int(re.search(rf"0x([0-9a-f]{{8}})\s+{symbol}\n", text)[1], 16)
            assert low <= address < low + 0x40000, f"{symbol} outside its window: {address:#x}"
        nm = run([tool / "arm-none-eabi-nm.exe", "-S", tree / "build/output/OpenPLC"], tree).stdout
        _, size, _, _ = next(line.split() for line in nm.splitlines() if line.endswith(" T fix_add"))
        run([tool / "arm-none-eabi-objcopy.exe", "-O", "binary", tree / "build/output/OpenPLC",
                       work / "raw.bin"], tree)
        raw = (work / "raw.bin").read_bytes()
        offset = int(re.search(r"0x([0-9a-f]{8})\s+fix_add\n", text)[1], 16) - 0x081C0000
        assert raw[offset:offset + int(size, 16)] in image, "fix_add code missing from OPEN_PLC.bin"
        print(f"PASS: libs linked, symbols in the PLC window, fix_add code present in OPEN_PLC.bin ({len(image)} bytes)")

        # A replaced library (same file name, new content) changes the image.
        replaced = build("replaced", ["liba2.a:liba.a", "libz.a"])[0]
        assert replaced and replaced != image, "replaced library not picked up"
        print("PASS: replaced library changes the image")

        for name, libs, fn, needle in (
            ("hard", ["hard.a", "libz.a"], "fix_add", "hard-float ABI"),
            ("undef", ["liba.a"], "fix_add", "undefined reference to `z_helper'"),
            ("big", ["big.a"], "big_use", "region `FLASH' overflowed"),
        ):
            image, log, _ = build(name, libs, fn)
            assert image is None and needle in log, f"{name}: expected failure containing {needle!r}\n{log}"
            print(f"PASS: {name} build fails with a readable message")

        if args.original_cmake:
            before = build("before", None, cmake=args.original_cmake)[0]
            after = build("after", None)[0]
            empty = build("empty", [])[0]
            assert before and before == after == empty, "OPEN_PLC.bin changed without libs"
            print("PASS: no-libs binary is byte-identical to the build before the change")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
