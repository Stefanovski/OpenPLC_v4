@echo off
set "CMAKE_PATH=C:\sysgcc\cmake\bin"
set "TOOLCHAIN_PATH=C:\sysgcc\arm-eabi\bin"
set "PATH=%CMAKE_PATH%;%TOOLCHAIN_PATH%;%PATH%"

rem Make changes to the source file before compiling
python precompile.py
if errorlevel 1 exit /b 1

echo CMake and Toolchain added to PATH temporarily.

rmdir /S /Q build
mkdir build

cmake -G "Ninja" -B build -DCMAKE_TOOLCHAIN_FILE=toolchain.cmake -DCMAKE_BUILD_TYPE=Debug . 
if errorlevel 1 exit /b 1
cmake --build build
if errorlevel 1 exit /b 1

rem Make the bin file 32 Bytes aligned for flashing and add MD5
python postcompile.py ./build/output/OPEN_PLC.bin 32 override
if errorlevel 1 exit /b 1
