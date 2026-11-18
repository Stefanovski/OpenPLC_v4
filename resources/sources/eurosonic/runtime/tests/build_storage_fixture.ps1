param([string]$Cmake = 'C:/sysgcc/cmake/bin/cmake.exe')
$ErrorActionPreference = 'Stop'
$runtimeRoot = (Resolve-Path "$PSScriptRoot/../..").Path
$repo = (Resolve-Path "$runtimeRoot/../../..").Path
$stage = Join-Path $env:TEMP ('gen2-plc-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($file in @('CMakeLists.txt','toolchain.cmake','openplc.lds','precompile.py','generate_storage.py')) {
    Copy-Item (Join-Path $runtimeRoot $file) $stage
}
New-Item -ItemType Directory -Path "$stage/runtime","$stage/src" | Out-Null
Get-ChildItem "$runtimeRoot/runtime" -File | Copy-Item -Destination "$stage/runtime"
Get-ChildItem "$runtimeRoot/src" -File | Copy-Item -Destination "$stage/src"
Copy-Item "$repo/resources/sources/MatIEC/lib" "$stage/src/lib" -Recurse
Copy-Item "$PSScriptRoot/storage_fixture.st" "$stage/src/program.st"
$savedPath = $env:PATH
$env:PATH = 'C:/sysgcc/arm-eabi/bin;C:/sysgcc/cmake/bin;' + $env:PATH
Push-Location "$stage/src"
try {
    & "$repo/resources/bin/win32/x64/iec2c.exe" -f -p -i -l -I "$stage/src/lib" program.st
    if ($LASTEXITCODE -ne 0) { throw 'MatIEC failed' }
    & "$repo/resources/bin/win32/x64/xml2st.exe" --generate-debug "$stage/src/program.st" "$stage/src/VARIABLES.csv"
    if ($LASTEXITCODE -ne 0) { throw 'Debug catalogue generation failed' }
    & "$repo/resources/bin/win32/x64/xml2st.exe" --generate-gluevars "$stage/src/LOCATED_VARIABLES.h"
    if ($LASTEXITCODE -ne 0) { throw 'Glue generation failed' }
} finally { Pop-Location }
Push-Location $stage
try {
    py precompile.py
    if ($LASTEXITCODE -ne 0) { throw 'Precompile failed' }
    & $Cmake -G Ninja -B build '-DCMAKE_TOOLCHAIN_FILE=toolchain.cmake' '-DCMAKE_BUILD_TYPE=Debug' .
    if ($LASTEXITCODE -ne 0) { throw 'CMake failed' }
    & $Cmake --build build
    if ($LASTEXITCODE -ne 0) { throw 'ARM PLC fixture build failed' }
    & 'C:/sysgcc/arm-eabi/bin/arm-none-eabi-objdump.exe' -h build/output/OpenPLC
    if ($LASTEXITCODE -ne 0) { throw 'PLC section inspection failed' }
} finally { Pop-Location; $env:PATH = $savedPath }
Write-Host "Fixture retained: $stage"
