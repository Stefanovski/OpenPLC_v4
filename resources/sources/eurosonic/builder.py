import json
import os
import requests
import platform as os_platform
import shutil
import subprocess
import multiprocessing as os_multiprocessing
from datetime import datetime
from enum import Enum, auto, unique
from typing import List, Set
import sys
import time
import select
from typing import Tuple, Optional
import re
from gettext import ngettext as _n
# from asciidoc.a2x import cli
import tftpy #

# List of OPLC dependencies
# This list can be reduced, as soon as the HALs list provides board specific library dependencies.
OPLC_DEPS = [
    'WiFiNINA',
    'Ethernet',
    'Arduino_MachineControl',
    'Arduino_EdgeControl',
    'OneWire',
    'DallasTemperature',
    'P1AM',
    'CONTROLLINO',
    'PubSubClient',
    'ArduinoJson',
    'ArduinoMqttClient',
    'RP2040_PWM',
    'AVR_PWM',
    'megaAVR_PWM',
    'SAMD_PWM',
    'SAMDUE_PWM',
    'Portenta_H7_PWM',
    'CAN',
    'STM32_CAN',
    'STM32_PWM'
]


_arduino_src_path = 'editor/arduino/src'

_eurosonic_base_path = 'editor/eurosonic'
_eurosonic_build_path = 'editor/eurosonic/openplc/build'
_eurosonic_openplc_path = 'editor/eurosonic/openplc' 
_eurosonic_runtime_path = 'editor/eurosonic/openplc/runtime' 
_eurosonic_core_path = 'editor/eurosonic/openplc/code'

_cli_command = []
_iec_transpiler = ''
_build_bat = ''

@unique
class BuildCacheOption(Enum):
    USE_CACHE = auto()
    CLEAN_BUILD = auto()
    UPGRADE_CORE = auto()
    UPGRADE_LIBS = auto()
    CLEAN_LIBS = auto()
    MR_PROPER = auto()

    def __lt__(self, other):
        if self.__class__ is other.__class__:
            return self.value < other.value
        return NotImplemented

    def __le__(self, other):
        if self.__class__ is other.__class__:
            return self.value <= other.value
        return NotImplemented

    def __gt__(self, other):
        if self.__class__ is other.__class__:
            return self.value > other.value
        return NotImplemented

    def __ge__(self, other):
        if self.__class__ is other.__class__:
            return self.value >= other.value
        return NotImplemented

    def __eq__(self, other):
        if self.__class__ is other.__class__:
            return self.value == other.value
        return NotImplemented

    def __ne__(self, other):
        if self.__class__ is other.__class__:
            return self.value != other.value
        return NotImplemented

def append_compiler_log(send_text, output):
    log_file_path = os.path.join(_arduino_src_path, 'build.log')
    try:
        with open(log_file_path, 'a', newline='') as log_file:
            lines = output.splitlines()
            for line in lines:
                timestamp = datetime.now().isoformat(timespec='milliseconds')
                log_file.write(f"[{timestamp}] {line}\n")
    except IOError as e:
        print(f"Fehler beim Schreiben in die Logdatei: {e}")

    send_text(output)

def runCommand(command):
    """
    Executes a command and returns its output.
    
    Args:
        command: Command to execute, either as a list of arguments or as a string.
                List format is preferred for safe handling of paths containing spaces.
                Example list: ['path/to/program', '--arg1', 'value1', '--arg2']
                
    Returns:
        str: Command output as UTF-8 string
        
    Raises:
        subprocess.CalledProcessError: If command execution fails
    """
    cmd_response = None
    kwargs = {
        'stderr': subprocess.STDOUT
    }
    
    # Add Windows-specific flags to prevent console window popup
    if os.name in ("nt", "ce"):
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    
    try:
        if isinstance(command, str):
            # Legacy support for string commands
            kwargs['shell'] = True
            cmd_response = subprocess.check_output(command, **kwargs)
        else:
            # List commands executed without shell - safe for paths with spaces
            kwargs['shell'] = False
            cmd_response = subprocess.check_output(command, **kwargs)
            
    except subprocess.CalledProcessError as exc:
        cmd_response = exc.output
        
    if cmd_response is None:
        return ''
        
    return cmd_response.decode('utf-8', errors='backslashreplace')

def read_output(process, send_text, timeout=None):
    start_time = time.time()
    return_code = 0

    while True:
        output = process.stdout.readline()
        if output:
            append_compiler_log(send_text, output)

        # check for process exit
        poll_result = process.poll()
        if poll_result is not None:
            # process terminated, read remaining output data
            for line in process.stdout:
                append_compiler_log(send_text, line)
            return_code = poll_result
            break

        # watch for the timeout
        if (timeout is not None) and ((time.time() - start_time) > timeout):
            process.kill()
            return_code = -1  # timeout error code
            break

        # brief sleep to reduce CPU load
        time.sleep(0.02)

    return return_code

def runCommandToWin(send_text, command, cwd=None, timeout=None):
    return_code = -2  # default value for unexpected errors
    append_compiler_log(send_text, '$ ' + ' '.join(map(str, command)) + '\n')

    popenargs = {
            "cwd":    os.getcwd() if cwd is None else cwd,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "bufsize": 1,
            "universal_newlines": True,
            "close_fds": True,
            "encoding": "utf-8",
            "errors": "backslashreplace"
        }

    try:
        # add extra flags for Windows
        if os.name in ("nt", "ce"):
            popenargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        # start the sub process
        compilation = subprocess.Popen(command, **popenargs)

        return_code = read_output(compilation, send_text, timeout)
        append_compiler_log(send_text, '$? = ' + str(return_code) + '\n')

    except subprocess.CalledProcessError as exc:
        append_compiler_log(send_text, exc.output)
        return_code = exc.returncode if exc.returncode is not None else -3

    return return_code

def log_host_info(send_text):
    # Number of logical CPU cores
    logical_cores = os_multiprocessing.cpu_count()

    # System architecture
    architecture = os_platform.architecture()[0]

    # Processor name
    processor = os_platform.processor()

    # Operating system
    os_name = os_platform.system()

    append_compiler_log(send_text, f"Host architecture: {architecture}\n")
    append_compiler_log(send_text, f"Processor: {processor}\n")
    append_compiler_log(send_text, f"Logical CPU cores: {logical_cores}\n")
    append_compiler_log(send_text, f"Operating system: {os_name}\n")

    # Additional information for Linux systems
    if os_name == "Linux":
        try:
            with open("/proc/cpuinfo", "r") as f:
                cpu_info = f.read()

            # Physical cores (rough estimate)
            physical_cores = len([line for line in cpu_info.split('\n') if line.startswith("physical id")])
            append_compiler_log(send_text, f"Estimated physical CPU cores: {physical_cores or 'Not available'}\n")

            # CPU frequency
            cpu_mhz = [line for line in cpu_info.split('\n') if "cpu MHz" in line]
            if cpu_mhz:
                append_compiler_log(send_text, f"CPU frequency: {cpu_mhz[0].split(':')[1].strip()} MHz\n")
            else:
                append_compiler_log(send_text, "CPU frequency: Not available\n")

        except Exception as e:
            append_compiler_log(send_text, f"Error reading /proc/cpuinfo: {e}\n")

    # Additional information for macOS systems
    elif os_name == "Darwin":  # Darwin is the core of macOS
        try:
            # Physical cores
            physical_cores = int(subprocess.check_output(["sysctl", "-n", "hw.physicalcpu"]).decode().strip())
            append_compiler_log(send_text, f"Physical CPU cores: {physical_cores}\n")

            # CPU frequency
            cpu_freq = subprocess.check_output(["sysctl", "-n", "hw.cpufrequency"]).decode().strip()
            cpu_freq_mhz = int(cpu_freq) / 1000000  # Convert Hz to MHz
            append_compiler_log(send_text, f"CPU frequency: {cpu_freq_mhz:.2f} MHz\n")

            # CPU model
            cpu_model = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"]).decode().strip()
            append_compiler_log(send_text, f"CPU model: {cpu_model}\n")

        except Exception as e:
            append_compiler_log(send_text, f"Error getting macOS CPU info: {e}\n")

    path_content = os.environ.get('PATH', '')
    append_compiler_log(send_text, "\n" + _("active PATH Variable") + ":\n" + path_content + "\n\n")

def are_libraries_installed(lib_list: List[str]) -> List[str]:
    """
    Check if the specified Arduino libraries are installed.
    
    Args:
        lib_list: List of library names to check
        
    Returns:
        List[str]: List of libraries that are not installed
    """
    try:
        # Get list of installed libraries in JSON format
        cmd = _cli_command + ['--json', 'lib', 'list']
        result = runCommand(cmd)
        
        if not result:
            return lib_list
            
        # Parse JSON output
        libraries_data = json.loads(result)
        
        # Get set of installed library names
        installed_libs = {
            lib.get('library', {}).get('name')
            for lib in libraries_data.get('installed_libraries', [])
        }
        
        # Return list of libraries that are not in installed set
        return [lib for lib in lib_list if lib not in installed_libs]
        
    except json.JSONDecodeError as e:
        append_compiler_log(send_text, _("Error parsing JSON output while checking libraries: {error}").format(error=str(e)) + '\n')
        return lib_list
    except Exception as e:
        append_compiler_log(send_text, _("Error checking libraries: {error}").format(error=str(e)) + '\n')
        return lib_list

def check_libraries_status() -> Tuple[int, str]:
    """
    Check the status of Arduino libraries using JSON output format.
    
    Returns:
        Tuple[int, str]: (Status code, Description)
        Status codes:
        0 - All up to date
        1 - Updates available
        2 - Error checking libraries
    """
    try:
        # Check for available updates using JSON format
        cmd = _cli_command + ['--json', 'lib', 'list', '--updatable']
        json_output = runCommand(cmd)
        
        # Parse JSON output
        lib_data = json.loads(json_output)
        updatable_libs = lib_data.get('installed_libraries', [])
        
        if not updatable_libs:
            return (0, _("All libraries are up to date"))
        
        lib_count = len(updatable_libs)
        return (1, _n(
            "Update available for {count} library",
            "Updates available for {count} libraries",
            lib_count
        ).format(count=lib_count))
            
    except json.JSONDecodeError as e:
        return (2, _("Error parsing JSON output: {error_message}").format(error_message=str(e)))
    except Exception as e:
        return (2, _("Error checking libraries: {error_message}").format(error_message=str(e)))
    
def get_installed_libraries(cli_command_str) -> List[str]:
    #print("Executing command:", cli_command_str + " lib list --json")
    cmd = _cli_command + ['--json', 'lib', 'list']
    libraries_json = runCommand(cmd)

    libraries_data = json.loads(libraries_json)
    installed_libs = []

    for lib in libraries_data.get("installed_libraries", []):
        lib_name = lib.get("library", {}).get("name")
        if lib_name:
            installed_libs.append(lib_name)

    #print("Installed libraries:", installed_libs)
    return installed_libs

def clean_libraries(send_text, _cli_command):
    # the intended behavior is to keep the list of installed libraries identical, but remove all and re-install all of them
    return_code = 0
    append_compiler_log(send_text, _("Cleaning libraries") + "...\n")
    installed_libraries = get_installed_libraries(' '.join(_cli_command))

    # Merge installed libraries with OPLC_DEPS and remove duplicates
    all_libraries: Set[str] = set(installed_libraries + OPLC_DEPS)

    append_compiler_log(send_text, _n(
        "Processing {count} library",
        "Processing {count} libraries",
        len(all_libraries)
    ).format(count=len(all_libraries)) + "\n")
    
    for lib in all_libraries:
        append_compiler_log(send_text, _("Processing library: {lib}").format(lib=lib) + "\n")
        runCommandToWin(send_text, _cli_command + ['lib', 'uninstall', lib])
        return_code = runCommandToWin(send_text, _cli_command + ['lib', 'install', lib])
        if (return_code != 0):
            append_compiler_log(send_text, '\n' + _('LIBRARIES INSTALLATION FAILED') + ': ' + lib + '\n')
            return

    return return_code

def upgrade_libraries(send_text) -> Tuple[bool, str]:
    """
    Performs upgrade of all outdated libraries.
    
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    try:
        # Update library index
        cmd = _cli_command + ['lib', 'update-index']
        runCommandToWin(send_text, cmd)
        
        # Check for updates
        status, message = check_libraries_status()
        if status == 0:  # All up to date
            return (True, message)
        elif status == 2:  # Error
            return (False, message)
            
        # Perform upgrade
        cmd = _cli_command + ['lib', 'upgrade']
        result = runCommandToWin(send_text, cmd)
        return (True, _("Libraries upgrade completed."))
            
    except Exception as e:
        return (False, _("Libraries upgrade failed: {error_message}").format(error_message=str(e)))

def get_cores_json(updatable: bool = False) -> dict:
    """
    Get JSON data of available Arduino cores.
    
    Args:
        updatable: If True, only return cores with available updates
        
    Returns:
        dict: Parsed JSON data of available cores. Empty dict if input is not a dict.
        The 'platforms' member will always be a list/tuple.
        
    Raises:
        json.JSONDecodeError: If JSON parsing fails
        subprocess.CalledProcessError: If command execution fails
    """
    # Build command
    cmd = _cli_command + ['--json', 'core', 'list']
    if updatable:
        cmd.append('--updatable')
        
    # Run command and get output
    result = runCommand(cmd)
    
    # Parse JSON output
    cores_data = json.loads(result)
    
    # Return empty dict if input is not a dict
    if not isinstance(cores_data, dict):
        return {}
        
    # Extract and validate platforms array, defaulting to empty list if not found
    platforms = cores_data.get('platforms', [])
    if not isinstance(platforms, (list, tuple)):
        platforms = []
    
    # Update platforms member with validated data
    cores_data['platforms'] = platforms
    
    return cores_data

def get_core_version(core_id: str) -> Optional[str]:
    """
    Get the installed version of a specific Arduino core.
    
    Args:
        core_id: The ID of the core (e.g. 'esp32:esp32')
        
    Returns:
        The installed version as string or None if core is not installed
    """
    cores_data = get_cores_json()
    
    # Search for the specified core
    for platform in cores_data['platforms']:
        if platform.get('id') == core_id:
            return platform.get('installed_version')
            
    return None

def check_core_status(core_name: str, updateCheck: bool = True) -> Tuple[int, str]:
    """
    Check the status of an Arduino core using JSON output.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[int, str]: (Status code, Description)
        Status codes:
        0 - Up to date or no action needed
        1 - Reinstallation recommended
        2 - First installation needed
    """
    if updateCheck:
        cmd = _cli_command + ['--json', 'core', 'update-index']
        result = runCommand(cmd)
        update_data = json.loads(result)
        
        if 'error' in update_data:
            return (2, _("Error updating core index: {error}").format(
                error=update_data.get('error', 'Unknown error')))
    
    # Check if core is installed using get_cores_json()
    cores_data = get_cores_json()
    
    core_found = False
    for platform in cores_data['platforms']:
        if platform.get('id') == core_name:
            core_found = True
            break
            
    if not core_found:
        return (2, _("Core {core_name} is not installed").format(core_name=core_name))
    
    if not updateCheck:
        return (0, _("Core {core_name} is installed").format(core_name=core_name))
    
    # Check for available updates using get_cores_json()
    updates_data = get_cores_json(updatable=True)
    
    for platform in updates_data['platforms']:
        if platform.get('id') == core_name:
            return (1, _("Updates found for {core_name}").format(core_name=core_name))
    
    return (0, _("No updates available for {core_name}").format(core_name=core_name))
    
def reinstall_core(send_text, core_name: str) -> Tuple[bool, str]:
    """
    Forces complete reinstallation of core.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    cmd = _cli_command + ['core', 'update-index']
    runCommandToWin(send_text, cmd)
    
    # Check if core exists using get_cores_json()
    cores_data = get_cores_json()
    
    core_installed = any(
        platform.get('id') == core_name 
        for platform in cores_data['platforms']
    )
    
    # Remove core if exists
    if core_installed:
        cmd = _cli_command + ['core', 'uninstall', core_name]
        runCommandToWin(send_text, cmd)
    
    # Install core
    cmd = _cli_command + ['core', 'install', core_name]
    result = runCommandToWin(send_text, cmd)
    if result != 0:
        return (False, _("Core reinstallation failed."))
    
    return (True, _("Core reinstallation completed.").format(result=result))

def upgrade_core(send_text, core_name: str, status = None) -> Tuple[bool, str]:
    """
    Performs necessary update actions for a core.
    
    Args:
        core_name: Name of the core (e.g. "esp32:esp32")
        
    Returns:
        Tuple[bool, str]: (Success, Description)
    """
    try:
        # Update index
        cmd = _cli_command + ['core', 'update-index']
        result = runCommandToWin(send_text, cmd)
        
        if status is None:
            # Check status
            status, message = check_core_status(core_name)
        
        if status == 0:
            # Double-check for updates with JSON output
            cmd = _cli_command + ['--json', 'core', 'list', '--updatable']
            result = runCommand(cmd)
            updates_data = json.loads(result)
            updatable_platforms = get_platform_list(updates_data)
            
            core_needs_update = any(
                platform.get('id') == core_name 
                for platform in updatable_platforms
            )
            
            if core_needs_update:
                cmd = _cli_command + ['core', 'upgrade', core_name]
                result = runCommandToWin(send_text, cmd)
                if result != 0:
                    return (False, _("Upgrade failed."))
                return (True, _("Upgrade successful."))
            return (True, _("No action needed"))
            
        elif status == 1:
            # Perform reinstallation
            cmd = _cli_command + ['core', 'uninstall', core_name]
            runCommandToWin(send_text, cmd)
            cmd = _cli_command + ['core', 'install', core_name]
            result = runCommandToWin(send_text, cmd)
            if result != 0:
                return (False, _("Reinstallation failed."))
            return (True, _("Reinstallation successful."))
            
        elif status == 2:
            # Perform first installation
            cmd = _cli_command + ['core', 'install', core_name]
            result = runCommandToWin(send_text, cmd)
            if result != 0:
                return (False, _("Initial core installation failed."))
            return (True, _("Initial core installation successful."))
            
    except Exception as e:
        return (False, _("Error with {core_name}: {err_msg}").format(core_name=core_name, err_msg=str(e)))

def is_board_url_configured(url: str) -> bool:
    """
    Check if a specific board manager URL is configured in arduino-cli.
    
    Args:
        url: Board manager URL to check
        
    Returns:
        bool: True if URL is configured, False otherwise
    """
    try:
        # Get current config
        cmd = _cli_command + ['config', 'dump', '--format', 'json']
        result = runCommand(cmd)
        
        # Parse JSON output
        config = json.loads(result)
        
        # Check if URL exists in board manager URLs
        configured_urls = config.get('config', {}).get('board_manager', {}).get('additional_urls', [])
        return url in configured_urls
        
    except Exception as e:
        print(f"Error checking board URL configuration: {e}")
        return False

def build(st_file, definitions, arduino_sketch, port, send_text, board_hal, build_option):
    """
    Build and optionally upload Arduino program with specified build cache options.
    
    Args:
        st_file: Content of the ST (Structured Text) file
        port: Serial port for upload (optional)
        send_text: Callback for user notifications
        board_hal: Board HAL configuration
        build_option: BuildCacheOption enum value
    """
    
    arduino_platform = board_hal['platform']
    source_file = board_hal['source']
    required_libs = OPLC_DEPS   # in the future this might take project libraries, board specific libraries and extension specific libraries too

    def setup_environment() -> bool:
        # Clear build log
        open(os.path.join(_eurosonic_core_path, 'build.log'), 'w').close()
        log_host_info(send_text)
        
        # Clean old files
        old_files = ['POUS.c', 'POUS.h', 'LOCATED_VARIABLES.h', 'VARIABLES.csv', 'Config0.c', 'Config0.h', 'Res0.c']
        for file in old_files:
            if os.path.exists(os.path.join(_eurosonic_core_path, file)):
                os.remove(os.path.join(_eurosonic_core_path, file))
            
        return True

    def verify_prerequisites() -> bool:
        # Check MatIEC compiler
        if not os.path.exists(_iec_transpiler):
            append_compiler_log(send_text, _("Error: iec2c compiler not found!") + '\n')
            return False
            
        if not os.path.exists(_cli_command[0]):
            append_compiler_log(send_text, _("Error: arduino-cli not found!") + '\n')
            return False
        
        runCommandToWin(send_text, [_iec_transpiler, '-v'])
        runCommandToWin(send_text, _cli_command + ['version'])
        
        return True

    def handle_board_installation() -> bool:
        append_compiler_log(send_text, 'Checking Core and Board installation...\n')
        core = board_hal['core']
        core_status, message = check_core_status(core, (build_option > BuildCacheOption.USE_CACHE))
        append_compiler_log(send_text, f'{message}\n')
        
        board_manager_url = board_hal.get('board_manager_url', None)
        if board_manager_url:
            board_installed = is_board_url_configured(board_manager_url)
        else:
            board_installed = re.match(r"arduino:.*", core) # usually all/only arduino cores do not need an additional board manager URL
        
        if not board_installed or build_option >= BuildCacheOption.MR_PROPER:
            append_compiler_log(send_text, _("Cleaning download cache") + "...\n")
            if runCommandToWin(send_text, _cli_command + ['cache', 'clean']) != 0:
                return False
                
            # Initialize config
            runCommandToWin(send_text, _cli_command + ['config', 'init'])    # ignore return value, most the time we would need '--overwrite', which is not our intent
                
            # Handle board manager URL if present
            if board_manager_url:
                cmds = [
                    ['config', 'remove', 'board_manager.additional_urls', board_manager_url],
                    ['config', 'add', 'board_manager.additional_urls', board_manager_url]
                ]
                for cmd in cmds:
                    if runCommandToWin(send_text, _cli_command + cmd) != 0:
                        return False
            
            # Install core
            success, message = reinstall_core(send_text, core)
            if not success:
                append_compiler_log(send_text, f'\n{message}\n')
                return False
            
            board_hal['last_update'] = time.time()
            board_hal['version'] = get_core_version(core)
            
        # Handle core updates based on build option
        elif core_status > 1 or build_option >= BuildCacheOption.UPGRADE_CORE:
            success, message = upgrade_core(send_text, core, core_status)
            if not success:
                append_compiler_log(send_text, f'\n{message}\n')
                return False
            
            board_hal['last_update'] = time.time()
            board_hal['version'] = get_core_version(core)
                
        append_compiler_log(send_text, f'\n')
        return True

    def compile_st_file() -> bool:
        append_compiler_log(send_text, _("Compiling .st file...") + '\n')
        # Write ST file
        with open(f'{_eurosonic_core_path}/plc_prog.st', 'w') as f:
            f.write(st_file)
            f.flush()
        
        time.sleep(0.2)  # ensure file is written
        
        # Compile based on platform

        cmd = [_iec_transpiler, '-f', '-l', '-p', 'openplc/code/plc_prog.st']
        cwd = _eurosonic_base_path
            
        runCommandToWin(send_text, cmd, cwd=cwd)

        # Clean old files
        files = ['POUS.c', 'POUS.h', 'LOCATED_VARIABLES.h', 'VARIABLES.csv', 'Config0.c', 'Config0.h', 'Res0.c']
        for file in files:
            if os.path.exists(os.path.join(_eurosonic_base_path, file)):
                shutil.move(os.path.join(_eurosonic_base_path, file), os.path.join(_eurosonic_core_path, file))

        return True
        
    def build_project() -> bool:
        append_compiler_log(send_text, _('Generating binary file...') + '\n')
        cmd = [os.path.abspath('editor/eurosonic/openplc/build.bat')]
        cwd = _eurosonic_openplc_path
        return runCommandToWin(send_text, cmd, cwd=cwd) == 0

    # def upload_binary(url, file_path, field_name="file", additional_data=None):
    #     """
    #     Uploads a binary file with a custom Content-Type header order.

    #     :param url: The endpoint to which the file will be uploaded.
    #     :param file_path: The path to the binary file to be uploaded.
    #     :param field_name: The field name for the file in the multipart form-data (default is 'file').
    #     :param additional_data: A dictionary of additional form data to include in the request.
    #     :return: Response object from the HTTP request.
    #     """
    #     # Define the boundary
    #     boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    #     additional_data = additional_data or {}

    #     # Construct the body
    #     body = []

    #     # Add additional form data
    #     for key, value in additional_data.items():
    #         body.append(f"--{boundary}")
    #         body.append(f'Content-Disposition: form-data; name="{key}"\r\n')
    #         body.append(value)

    #     # Add the binary file
    #     body.append(f"--{boundary}")
    #     body.append(f'Content-Disposition: form-data; name="{field_name}"; filename="{os.path.basename(file_path)}"')
    #     body.append("Content-Type: application/octet-stream\r\n")

    #     # Append binary content
    #     with open(file_path, "rb") as binary_file:
    #         body.append(binary_file.read())

    #     # Close the body with the boundary
    #     body.append(f"--{boundary}--\r\n")

    #     # Join all parts with CRLF
    #     body = b"\r\n".join([part if isinstance(part, bytes) else part.encode() for part in body])

    #     # Set headers
    #     headers = {
    #         "Content-Type": f"multipart/form-data; boundary={boundary}",
    #     }

    #     # Send the request
    #     response = requests.post(url, headers=headers, data=body)
    #     return response


    def upload_binary(url, file_path, field_name="file", additional_data=None):
        """
        TFTP-Version von upload_binary mit derselben Signatur wie die HTTP-Version.
        
        :param url: Hier wird die IP-Adresse oder die URL des Zielgeräts erwartet.
        :param file_path: Pfad zur lokalen .bin Datei.
        :param field_name: (Wird ignoriert, nur für Kompatibilität vorhanden)
        :param additional_data: (Wird ignoriert, nur für Kompatibilität vorhanden)
        """
        import tftpy
        from urllib.parse import urlparse

        # 1. Host/IP aus dem 'url' Parameter extrahieren
        # Unterstützt "192.168.200.240", "http://192.168.200.240/..." oder "tftp://192.168.200.240"
        parsed = urlparse(url)
        host = parsed.hostname or (parsed.path.split('/')[0] if '/' in parsed.path and '.' in parsed.path.split('/')[0] else url)
        if not host or host == "": host = url # Fallback falls kein Schema vorhanden ist
        
        # Falls in der URL ein Port enthalten ist (z.B. 192.168.1.1:69)
        port = 69
        if ':' in host and not host.startswith('['): # Einfaches Handling für Port-Anhänge
            try:
                host_parts = host.split(':')
                host = host_parts[0]
                port = int(host_parts[1])
            except: pass

        # 2. Pfad-Normalisierung (wie in tftp_upload.py gefordert)
        remote_name = os.path.basename(file_path)
        remote_name = remote_name.replace("\\", "/")
        while remote_name.startswith("/"):
            remote_name = remote_name[1:]

        # 3. TFTP Optionen (Wichtig: Keine Optionen bei Blockgröße 512 für maximale Kompatibilität)
        opts = {} 
        # Wenn du eine andere Blockgröße erzwingen müsstest, käme sie hier in 'opts'
        
        try:
            client = tftpy.TftpClient(host, port, options=opts)
            # Timeout auf 5.0s setzen wie im Beispiel
            client.upload(remote_name, file_path, timeout=5.0)
            
            # Wir geben ein Objekt zurück, das 'status_code' besitzt, falls der Aufrufer diesen prüft
            class MockResponse:
                status_code = 200
                text = "TFTP Upload Successful"
            return MockResponse()
            
        except Exception as e:
            # Im Fehlerfall geben wir None oder ein Objekt mit Fehler-Code zurück
            print(f"[!] TFTP Upload failed: {e}")
            class MockError:
                status_code = 500
                text = str(e)
            return MockError()




    def upload_if_needed() -> bool:
        if port is None:
            # Show output directory
            cwd = os.getcwd()
            build_dir = f"{os.path.join(_eurosonic_build_path, 'output')}"
            append_compiler_log(send_text, f'\n{_("OUTPUT DIRECTORY:")}:\n{_eurosonic_build_path}/output\n')
            append_compiler_log(send_text, '\n' + _('COMPILATION DONE!'))
            return True
            
        # Upload to board
        append_compiler_log(send_text, f'\n{_("Uploading program to Generator board at {port}...")}\n')

        url = 'http://192.168.200.240/upload_plc.cgi'
        response = upload_binary(url, os.path.join(_eurosonic_build_path, 'output', 'OPEN_PLC.bin'))

        append_compiler_log(send_text, '\n' + _('Done!') + '\n')
        return True

    def cleanup_build() -> bool:
        # cleanup build remains
        time.sleep(1)  # ensure files are not in use
        
        # return early, no clean up
        return True
    
        # Clean up and return
        if os.path.exists(_arduino_src_path+'POUS.c'):
            os.remove(_arduino_src_path+'POUS.c')
        if os.path.exists(_arduino_src_path+'POUS.h'):
            os.remove(_arduino_src_path+'POUS.h')
        if os.path.exists(_arduino_src_path+'LOCATED_VARIABLES.h'):
            os.remove(_arduino_src_path+'LOCATED_VARIABLES.h')
        if os.path.exists(_arduino_src_path+'VARIABLES.csv'):
            os.remove(_arduino_src_path+'VARIABLES.csv')
        if os.path.exists(_arduino_src_path+'Config0.c'):
            os.remove(_arduino_src_path+'Config0.c')
        if os.path.exists(_arduino_src_path+'Config0.h'):
            os.remove(_arduino_src_path+'Config0.h')
        if os.path.exists(_arduino_src_path+'Config0.o'):
            os.remove(_arduino_src_path+'Config0.o')
        if os.path.exists(_arduino_src_path+'Res0.c'):
            os.remove(_arduino_src_path+'Res0.c')
        if os.path.exists(_arduino_src_path+'Res0.o'):
            os.remove(_arduino_src_path+'Res0.o')
        if os.path.exists(_arduino_src_path+'glueVars.c'):
            os.remove(_arduino_src_path+'glueVars.c')


    # Main build sequence
    build_phases = [
        setup_environment, #ok
        verify_prerequisites, #ok
        handle_board_installation, #überarbeiten auf c:/sysgcc/
        compile_st_file,
        build_project,
        upload_if_needed,
        cleanup_build
    ]
    
    for phase in build_phases:
        if not phase():
            return
            
def setup_module():
    # import global variables writable, we want set them up
    global _arduino_src_path, _cli_command, _iec_transpiler
    _eurosonic_src_path = 'editor/eurosonic/src'
    
    # Convert _arduino_src_path to absolute path
    _eurosonic_src_path = os.path.abspath(_eurosonic_src_path)
    
    # Setup CLI command based on platform
    if os_platform.system() == 'Windows':
        _cli_command = [os.path.abspath('editor\\eurosonic\\bin\\arduino-cli-w64.exe'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/eurosonic/bin/iec2c.exe')
        _build_bat = os.path.abspath('editor/eurosonic/openplc/build.bat')
    elif os_platform.system() == 'Darwin':
        _cli_command = [os.path.abspath('editor/eurosonic/bin/arduino-cli-mac'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/eurosonic/bin/iec2c_mac')
    else:
        _cli_command = [os.path.abspath('editor/eurosonic/bin/arduino-cli-l64'), '--no-color']
        _iec_transpiler = os.path.abspath('editor/eurosonic/bin/iec2c')
        
    return None

# run this on module load time
setup_module()
