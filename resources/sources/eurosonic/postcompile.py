import sys
import os
import hashlib
import struct


def pad_binary(filename, alignment):
    """Pad the binary file to the specified alignment."""
    with open(filename, "ab") as f:
        file_size = os.path.getsize(filename)
        padding_needed = (alignment - (file_size % alignment)) % alignment
        f.write(b'\x00' * padding_needed)


def calculate_md5(filename, exclude_header):
    """Calculate the MD5 hash of the file."""
    md5_hash = hashlib.md5()
    with open(filename, "rb") as f:
        if exclude_header:
            f.seek(256)  # Skip the existing header
        for chunk in iter(lambda: f.read(4096), b""):
            md5_hash.update(chunk)
    return md5_hash.digest()


def header_exists(filename):
    """Check if the header already exists in the binary."""
    with open(filename, "rb") as f:
        f.seek(8)  # Position of `uiHeaderStart` in the header
        header_start = struct.unpack('<I', f.read(4))[0]
        return header_start == 0xCAFEBABE


def update_or_prepend_header(filename, md5_hash, override, custom_name=None):
    """Update or prepend the 256-byte header to the binary file."""
    file_size = os.path.getsize(filename) - (256 if override else 0)
    binary_length = file_size

    # Use custom filename if provided; otherwise, extract from `filename`
    base_filename = custom_name if custom_name else os.path.basename(filename)

    # Read the first 8 bytes of the binary file
    with open(filename, "rb") as f:
        first_8_bytes = f.read(8)

    if len(first_8_bytes) < 8:
        raise ValueError("Binary file is too small to extract the first 8 bytes.")

    # Prepare the `FlashHeader_t` structure
    uiHeaderStart = 0xCAFEBABE
    uiBinaryLength = binary_length  # Length of the binary without the header
    aInfo = base_filename.encode('ascii')[:31] + b'\0'  # Filename, null-terminated
    aMD5 = md5_hash

    # Build the header (256 bytes)
    header = struct.pack(
        '<8sII32s16s',
        first_8_bytes,    # 8 bytes: Copied from the beginning of the binary file
        uiHeaderStart,    # 4 bytes: Magic number
        uiBinaryLength,   # 4 bytes: Binary length
        aInfo,            # 32 bytes: Application info
        aMD5              # 16 bytes: MD5 checksum
    )
    header = header.ljust(256, b'\x00')  # Pad the rest of the header to 256 bytes

    if override:
        # Overwrite the existing header
        with open(filename, "r+b") as f:
            f.seek(0)  # Start of the file
            f.write(header)
    else:
        # Prepend the header to the file
        with open(filename, "rb") as f:
            original_content = f.read()
        with open(filename, "wb") as f:
            f.write(header + original_content)  # Write header + original content


if __name__ == "__main__":
    if len(sys.argv) not in {4, 5}:
        print("Usage: python postcompile.py <filename> <alignment> <override|append> [custom_name]")
        sys.exit(1)

    filename = sys.argv[1]
    alignment = int(sys.argv[2])
    mode = sys.argv[3].lower()
    custom_name = sys.argv[4] if len(sys.argv) == 5 else None

    if mode not in {"override", "append"}:
        print("Error: Mode must be 'override' or 'append'.")
        sys.exit(1)

    # Step 1: Pad the binary
    pad_binary(filename, alignment)

    # Step 2: If mode is "append", check if header already exists
    override = (mode == "override")
    if mode == "append" and header_exists(filename):
        print("Header already exists. Switching to 'override' mode.")
        override = True

    # Step 3: Calculate MD5 hash of the binary (excluding the header if overriding)
    md5_hash = calculate_md5(filename, exclude_header=override)

    # Step 4: Update or prepend the 256-byte header
    update_or_prepend_header(filename, md5_hash, override, custom_name)

    print(f"Processed '{filename}':")
    print(f"- Padded to {alignment}-byte alignment.")
    if override:
        print(f"- Overwrote existing 256-byte header with calculated MD5 and other information.")
    else:
        print(f"- Prepended 256-byte header with calculated MD5 and other information.")
    if custom_name:
        print(f"- Used custom filename '{custom_name}' in the header.")
