"""Reject native startup requirements that the PLC loader cannot execute.

The PLC entry point initializes IEC state, not the C++ process runtime. Check
objects before linking/garbage collection, so an unused global constructor
cannot silently turn a successful build into uninitialized target state.
"""
import pathlib
import struct
import sys


def check_object(path):
    data = path.read_bytes()
    if data[:6] != b"\x7fELF\x01\x01":
        raise ValueError(f"Expected a little-endian ELF32 ARM object: {path}")
    if struct.unpack_from("<H", data, 18)[0] != 40:
        raise ValueError(f"Expected ARM object: {path}")
    offset = struct.unpack_from("<I", data, 32)[0]
    stride, count, string_index = struct.unpack_from("<HHH", data, 46)
    sections = [struct.unpack_from("<10I", data, offset + i * stride) for i in range(count)]
    strings = sections[string_index]
    names = data[strings[4]:strings[4] + strings[5]]
    for section in sections:
        name = names[section[0]:].split(b"\0", 1)[0].decode("ascii")
        if section[5] and name.startswith((".init_array", ".preinit_array", ".ctors", ".fini_array", ".dtors")):
            raise ValueError(
                f"{path.name}: global C++ constructors/destructors are not supported by the PLC loader. "
                "Initialize per-instance IEC local variables in setup()."
            )


def main():
    root = pathlib.Path(sys.argv[1])
    objects = [p for p in root.rglob("eurosonic_cpp_*.cpp.*") if p.suffix in (".o", ".obj")]
    if not objects:
        raise ValueError(f"No generated C++ objects found in {root}")
    for path in objects:
        check_object(path)
    print(f"Validated {len(objects)} Eurosonic C++ object(s).")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, struct.error, IndexError) as error:
        print(f"C++ validation failed: {error}", file=sys.stderr)
        sys.exit(1)
