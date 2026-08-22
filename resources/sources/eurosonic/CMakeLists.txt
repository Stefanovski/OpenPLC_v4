# Minimum version required
cmake_minimum_required(VERSION 3.15)

# Project definition
project(OpenPLC LANGUAGES C CXX)

# Specify the C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/lib
    ${CMAKE_SOURCE_DIR}/modbus
	${CMAKE_SOURCE_DIR}/modbus/lightmodbus
    ${CMAKE_SOURCE_DIR}/runtime
)

# Add all source files
file(GLOB_RECURSE SOURCES
    ${CMAKE_SOURCE_DIR}/src/*.cpp
    ${CMAKE_SOURCE_DIR}/src/*.c
    ${CMAKE_SOURCE_DIR}/runtime/*.cpp
    ${CMAKE_SOURCE_DIR}/runtime/*.c
)

# Host-side unit tests are intentionally kept beside the embedded runtime, but
# must never be linked into the controller firmware.
list(FILTER SOURCES EXCLUDE REGEX ".*/runtime/tests/.*")

# Statement debugging is an explicit build mode. A normal build does not link
# the breakpoint runtime or reserve its fixed ABI table.
list(FILTER SOURCES EXCLUDE REGEX ".*/plc_debug_runtime\\.c$")
if(EXISTS ${CMAKE_SOURCE_DIR}/src/program.debug.json)
    list(APPEND SOURCES ${CMAKE_SOURCE_DIR}/runtime/plc_debug_runtime.c)
    add_compile_definitions(PLC_DEBUG_ENABLED=1)
endif()

# Add the executable target
add_executable(OpenPLC ${SOURCES})

# Add libraries if necessary
#target_link_libraries(OpenPLC PRIVATE <external_library>)

# Use the custom toolchain
set(CMAKE_TOOLCHAIN_FILE ${CMAKE_SOURCE_DIR}/toolchain.cmake)

target_link_options(OpenPLC PRIVATE -Wl,-Map=${CMAKE_BINARY_DIR}/OpenPLC.map)

# Additional settings
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(OpenPLC PRIVATE -Wall -Wextra -pedantic)
endif()

add_custom_command(
    TARGET OpenPLC POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:OpenPLC> ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/OPEN_PLC.bin
    COMMENT "Converting ELF to BIN"
)

#add_custom_command(
#    TARGET OpenPLC POST_BUILD
#    COMMAND ${CMAKE_OBJCOPY} -O binary -R .bss $<TARGET_FILE:OpenPLC> ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}/OPEN_PLC.bin
#    COMMENT "Converting ELF to BIN and excluding unnecessary sections"
#)
