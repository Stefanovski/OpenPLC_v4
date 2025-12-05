# Specify the target system
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

# Define the path to your GCC toolchain
set(TOOLCHAIN_PATH "C:/sysgcc/arm-eabi")

# Specify the compilers
set(CMAKE_C_COMPILER "C:/sysgcc/arm-eabi/bin/arm-none-eabi-gcc.exe")
set(CMAKE_CXX_COMPILER "C:/sysgcc/arm-eabi/bin/arm-none-eabi-g++.exe")
set(CMAKE_ASM_COMPILER "C:/sysgcc/arm-eabi/bin/arm-none-eabi-gcc.exe")

# Define the flags for the compiler and linker
set(CMAKE_C_FLAGS "-mcpu=cortex-m7 -mthumb -ffunction-sections -fdata-sections")
set(CMAKE_CXX_FLAGS "-mcpu=cortex-m7 -mthumb -ffunction-sections -fdata-sections")
set(CMAKE_EXE_LINKER_FLAGS "-mcpu=cortex-m7 -mthumb -Wl,--gc-sections")

# Specify the linker script
set(LINKER_SCRIPT "${CMAKE_SOURCE_DIR}/openplc.lds")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -T${LINKER_SCRIPT}")

# Specify additional include directories (adjust paths as needed)
include_directories(
    ${TOOLCHAIN_PATH}/include
    ${CMAKE_SOURCE_DIR}/include
)

# Specify additional library directories (adjust paths as needed)
link_directories(
    ${TOOLCHAIN_PATH}/lib
)

# Set the output directory for build artifacts
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/output)

# Optional: Additional debug flags for development
set(CMAKE_C_FLAGS_DEBUG "-g -O0")
set(CMAKE_C_FLAGS_RELEASE "-O0 -g3")
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0")
set(CMAKE_CXX_FLAGS_RELEASE "-O0 -g3")

set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Suppress all warnings
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -w")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -w")

