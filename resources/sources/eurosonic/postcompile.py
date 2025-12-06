import sys
import os
import hashlib
import struct
import re # NEU: Für Regex Suche in defines.h

HEADER_SIZE = 1024  # 0x400

# Pfad zur defines.h relativ zum Skript-Verzeichnis
DEFINES_REL_PATH = os.path.join("src", "defines.h")

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
            f.seek(HEADER_SIZE)  # Skip the existing header
        for chunk in iter(lambda: f.read(4096), b""):
            md5_hash.update(chunk)
    return md5_hash.digest()


def header_exists(filename):
    """Check if the header already exists in the binary."""
    with open(filename, "rb") as f:
        f.seek(8)
        data = f.read(4)
        if len(data) < 4:
            return False  # Datei zu klein  kein Header vorhanden
        header_start = struct.unpack('<I', data)[0]
        return header_start == 0xCAFEBABE

# --- NEU: Funktion zum Auslesen des Strings aus defines.h ---
def get_plc_md5_string():
    """
    Liest ./src/defines.h und extrahiert PROGRAM_MD5.
    Gibt Bytes der Länge 32 zurück.
    """
    # Absoluter Pfad basierend auf dem Ort dieses Skripts
    script_dir = os.path.dirname(os.path.abspath(__file__))
    defines_path = os.path.join(script_dir, DEFINES_REL_PATH)

    print(f"Suche nach defines.h in: {defines_path}")

    if not os.path.exists(defines_path):
        print(f"WARNUNG: {defines_path} nicht gefunden! plcMD5 wird mit Nullen gefüllt.")
        return b'\x00' * 32

    try:
        with open(defines_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Regex sucht: #define PROGRAM_MD5 "irgendwas"
            match = re.search(r'#define\s+PROGRAM_MD5\s+"([a-fA-F0-9]{32})"', content)
            if match:
                md5_str = match.group(1)
                print(f"Gefundener PLC MD5: {md5_str}")
                return md5_str.encode('ascii')
            else:
                print("WARNUNG: PROGRAM_MD5 Makro in defines.h nicht gefunden.")
                return b'\x00' * 32
    except Exception as e:
        print(f"FEHLER beim Lesen von defines.h: {e}")
        return b'\x00' * 32

# --- Signatur erweitert: plc_md5_string hinzugefügt ---
def update_or_prepend_header(filename, md5_hash, plc_md5_string, override, custom_name=None):
    """Update or prepend the 1024-byte header to the binary file."""
    file_size = os.path.getsize(filename) - (HEADER_SIZE if override else 0)
    binary_length = file_size

    base_filename = custom_name if custom_name else os.path.basename(filename)

    # --- FIX: 8 Bytes aus der Payload holen, nicht aus evtl. altem Header ---
    with open(filename, "rb") as f:
        if override:
            f.seek(HEADER_SIZE)   # skip existing header to read real vectors
        first_8_bytes = f.read(8)

    if len(first_8_bytes) < 8:
        raise ValueError("Binary file is too small to extract the first 8 bytes.")

    uiHeaderStart = 0xCAFEBABE
    uiBinaryLength = binary_length
    aInfo = base_filename.encode("ascii")[:31] + b"\0"
    aMD5 = md5_hash # Das ist der Runtime Hash (binär)
    uiState = bytes([1])  # 0x01 = FW_STATE_PENDING
    
    # NEU: Sicherstellen dass der PLC String genau 32 bytes hat
    plcMD5 = plc_md5_string.ljust(32, b'\x00')[:32]

    # Build header
    # Format erweitert: ...B32s -> B (uiState) gefolgt von 32s (plcMD5 String)
    header = struct.pack("<8sII32s16sB32s", 
                         first_8_bytes,
                         uiHeaderStart, 
                         uiBinaryLength, 
                         aInfo, 
                         aMD5, 
                         uiState[0],
                         plcMD5) # NEU: Angefügt
                         
    header = header.ljust(HEADER_SIZE, b"\x00")

    if override:
        with open(filename, "r+b") as f:
            f.seek(0)
            f.write(header)
    else:
        with open(filename, "rb") as f:
            original = f.read()
        with open(filename, "wb") as f:
            f.write(header + original)


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

    pad_binary(filename, alignment)

    override = (mode == "override")
    if mode == "append" and header_exists(filename):
        print("Header already exists. Switching to 'override' mode.")
        override = True

    md5_hash = calculate_md5(filename, exclude_header=override)

    # NEU: PLC MD5 auslesen
    plc_md5_str = get_plc_md5_string()

    # NEU: Übergeben an die Update Funktion
    update_or_prepend_header(filename, md5_hash, plc_md5_str, override, custom_name)

    print(f"Processed '{filename}':")
    print(f"- Padded to {alignment}-byte alignment.")
    if override:
        print(f"- Overwrote existing 1024-byte header with calculated MD5 and other information.")
    else:
        print(f"- Prepended 1024-byte header with calculated MD5 and other information.")
    if custom_name:
        print(f"- Used custom filename '{custom_name}' in the header.")
    
    # Info Ausgabe
    print(f"- PLC MD5 patched into header: {plc_md5_str.decode('ascii', errors='ignore')}")