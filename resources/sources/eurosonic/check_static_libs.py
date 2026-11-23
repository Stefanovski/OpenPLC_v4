"""Reject project static libraries that cannot link into the Eurosonic PLC image.

The PLC image is built with -mcpu=cortex-m7 -mthumb and the soft-float ABI
(no -mfloat-abi flag). A library built for the hard-float ABI fails late in the
link with a terse message, or links into an image that crashes on the first
float call. Check every ELF member of every archive before linking instead.
"""
import pathlib
import struct
import sys

EM_ARM = 40
SHT_ARM_ATTRIBUTES = 0x70000003
TAG_ABI_VFP_ARGS = 28
# Attribute tags whose value is a NUL-terminated string rather than a ULEB128.
STRING_TAGS = (4, 5, 65, 67)
HINT = (
    "The Eurosonic PLC target is -mcpu=cortex-m7 -mthumb with the soft-float ABI. "
    "Rust: build for thumbv7em-none-eabi, not thumbv7em-none-eabihf. "
    "C/C++: do not pass -mfloat-abi=hard."
)


def uleb(data, pos):
    value = shift = 0
    while True:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, pos


def vfp_args(attributes):
    """Return Tag_ABI_VFP_args from a .ARM.attributes section, or None if absent."""
    if attributes[:1] != b"A":
        return None
    pos = 1
    while pos + 4 <= len(attributes):
        (length,) = struct.unpack_from("<I", attributes, pos)
        end = pos + length
        vendor_end = attributes.index(b"\0", pos + 4)
        vendor = attributes[pos + 4:vendor_end]
        pos = vendor_end + 1
        if vendor != b"aeabi":
            pos = end
            continue
        while pos + 5 <= end:
            tag = attributes[pos]
            (size,) = struct.unpack_from("<I", attributes, pos + 1)
            body, sub_end = pos + 5, pos + size
            pos = sub_end
            if tag != 1:  # 1 = file-wide attributes
                continue
            while body < sub_end:
                name, body = uleb(attributes, body)
                if name in STRING_TAGS:
                    body = attributes.index(b"\0", body) + 1
                elif name == 32:  # Tag_compatibility: ULEB flag, then a string
                    _, body = uleb(attributes, body)
                    body = attributes.index(b"\0", body) + 1
                else:
                    value, body = uleb(attributes, body)
                    if name == TAG_ABI_VFP_ARGS:
                        return value
        pos = end
    return None


def check_object(data, where):
    if data[:4] != b"\x7fELF":
        return  # not an object (for example a symbol table); the linker decides
    if data[4] != 1 or data[5] != 1:
        raise ValueError(f"{where}: expected a little-endian ELF32 object. {HINT}")
    if struct.unpack_from("<H", data, 18)[0] != EM_ARM:
        raise ValueError(f"{where}: not an ARM object. {HINT}")
    offset = struct.unpack_from("<I", data, 32)[0]
    stride, count = struct.unpack_from("<HH", data, 46)
    for index in range(count):
        header = struct.unpack_from("<10I", data, offset + index * stride)
        if header[1] == SHT_ARM_ATTRIBUTES:
            if vfp_args(data[header[4]:header[4] + header[5]]) == 1:
                raise ValueError(f"{where}: built for the hard-float ABI. {HINT}")


def members(archive):
    data = archive.read_bytes()
    if data[:8] != b"!<arch>\n":
        raise ValueError(f"{archive.name}: not a static library (ar archive)")
    names = b""
    pos = 8
    while pos + 60 <= len(data):
        name = data[pos:pos + 16].decode("ascii").strip()
        size = int(data[pos + 48:pos + 58])
        body = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size & 1)
        if name == "//":
            names = body
        elif name in ("/", "/SYM64/"):
            continue
        else:
            if name.startswith("/") and name[1:].isdigit():
                start = int(name[1:])
                name = names[start:names.index(b"\n", start)].decode("ascii").rstrip("/")
            yield name.rstrip("/"), body


def main():
    libraries = [pathlib.Path(arg) for arg in sys.argv[1:]]
    if not libraries:
        raise ValueError("No libraries given")
    for library in libraries:
        for name, body in members(library):
            check_object(body, f"{library.name}({name})")
    print(f"Validated {len(libraries)} static librar{'y' if len(libraries) == 1 else 'ies'}: soft-float ARM.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, struct.error, IndexError) as error:
        print(f"Static library validation failed: {error}", file=sys.stderr)
        sys.exit(1)
