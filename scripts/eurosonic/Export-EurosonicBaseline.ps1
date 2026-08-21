[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$configurationPath = Join-Path $resolvedProjectPath 'devices\configuration.json'
$programPath = Join-Path $resolvedProjectPath 'build\Eurosonic_Gen2\src\program.st'
$definesPath = Join-Path $resolvedProjectPath 'build\Eurosonic_Gen2\src\defines.h'
$binaryPath = Join-Path $resolvedProjectPath 'build\Eurosonic_Gen2\build\output\OPEN_PLC.bin'

$relativePaths = @(
  'project.json',
  'plc.xml',
  'devices/configuration.json',
  'devices/pin-mapping.json',
  'pous/programs/main.ld',
  'build/Eurosonic_Gen2/src/program.st',
  'build/Eurosonic_Gen2/src/defines.h',
  'build/Eurosonic_Gen2/src/Config0.c',
  'build/Eurosonic_Gen2/src/debug.c',
  'build/Eurosonic_Gen2/src/glueVars.c',
  'build/Eurosonic_Gen2/src/LOCATED_VARIABLES.h',
  'build/Eurosonic_Gen2/build/OpenPLC.map',
  'build/Eurosonic_Gen2/build/output/OpenPLC',
  'build/Eurosonic_Gen2/build/output/OPEN_PLC.bin'
)

$files = foreach ($relativePath in $relativePaths) {
  $nativeRelativePath = $relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $fullPath = Join-Path $resolvedProjectPath $nativeRelativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    [ordered]@{
      path = $relativePath
      exists = $false
    }
    continue
  }

  $item = Get-Item -LiteralPath $fullPath
  [ordered]@{
    path = $relativePath
    exists = $true
    size = $item.Length
    lastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
    sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
$locatedVariables = @()
if (Test-Path -LiteralPath $programPath -PathType Leaf) {
  $program = Get-Content -LiteralPath $programPath -Raw
  foreach ($match in [regex]::Matches($program, '(?im)^\s*([A-Za-z_][A-Za-z0-9_]*)\s+AT\s+(%[IQM][XWDLB]?\d+(?:\.\d+)?)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)')) {
    $locatedVariables += [ordered]@{
      name = $match.Groups[1].Value
      location = $match.Groups[2].Value
      type = $match.Groups[3].Value.ToUpperInvariant()
    }
  }
}

$programMd5 = $null
if (Test-Path -LiteralPath $definesPath -PathType Leaf) {
  $defines = Get-Content -LiteralPath $definesPath -Raw
  $programMd5Match = [regex]::Match($defines, '#define\s+PROGRAM_MD5\s+"([a-fA-F0-9]{32})"')
  if ($programMd5Match.Success) {
    $programMd5 = $programMd5Match.Groups[1].Value.ToLowerInvariant()
  }
}

$binaryHeader = $null
if (Test-Path -LiteralPath $binaryPath -PathType Leaf) {
  $stream = [System.IO.File]::OpenRead($binaryPath)
  try {
    if ($stream.Length -ge 1024) {
      $reader = [System.IO.BinaryReader]::new($stream)
      $firstVectors = $reader.ReadBytes(8)
      $headerMarker = $reader.ReadUInt32()
      $payloadLength = $reader.ReadUInt32()
      $info = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(32)).TrimEnd([char]0)
      $runtimeMd5 = -join ($reader.ReadBytes(16) | ForEach-Object { $_.ToString('x2') })
      $state = $reader.ReadByte()
      $headerProgramMd5 = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(32)).TrimEnd([char]0)

      $stream.Position = 1024
      $md5 = [System.Security.Cryptography.MD5]::Create()
      try {
        $calculatedRuntimeMd5 = -join ($md5.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
      } finally {
        $md5.Dispose()
      }

      $binaryHeader = [ordered]@{
        marker = ('0x{0:X8}' -f $headerMarker)
        info = $info
        state = $state
        payloadLength = $payloadLength
        firstVectors = -join ($firstVectors | ForEach-Object { $_.ToString('x2') })
        runtimeMd5 = $runtimeMd5
        calculatedRuntimeMd5 = $calculatedRuntimeMd5
        runtimeMd5Matches = $runtimeMd5 -eq $calculatedRuntimeMd5
        programMd5 = $headerProgramMd5
        programMd5MatchesDefines = $null -ne $programMd5 -and $headerProgramMd5 -eq $programMd5
      }
    }
  } finally {
    $stream.Dispose()
  }
}

$generatedSourcePaths = @(
  $programPath,
  (Join-Path $resolvedProjectPath 'build\Eurosonic_Gen2\src\debug.c'),
  (Join-Path $resolvedProjectPath 'build\Eurosonic_Gen2\src\plc.xml')
)
$generatedSources = @($generatedSourcePaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { Get-Item -LiteralPath $_ })
$binaryItem = if (Test-Path -LiteralPath $binaryPath -PathType Leaf) { Get-Item -LiteralPath $binaryPath } else { $null }
$newestGeneratedSourceUtc = if ($generatedSources.Count -gt 0) {
  ($generatedSources | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
} else {
  $null
}

$networkConfiguration = $configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration
$result = [ordered]@{
  schemaVersion = 1
  capturedAtUtc = [DateTime]::UtcNow.ToString('o')
  projectPath = $resolvedProjectPath
  board = $configuration.deviceBoard
  network = [ordered]@{
    tcpEnabled = $configuration.communicationConfiguration.communicationPreferences.enabledTCP
    dhcpEnabled = $configuration.communicationConfiguration.communicationPreferences.enabledDHCP
    ipAddress = $networkConfiguration.ipAddress
  }
  programMd5 = $programMd5
  locatedVariables = $locatedVariables
  generatedSourcesNewerThanBinary = $null -ne $binaryItem -and $null -ne $newestGeneratedSourceUtc -and $newestGeneratedSourceUtc -gt $binaryItem.LastWriteTimeUtc
  binaryHeader = $binaryHeader
  files = $files
}

$result | ConvertTo-Json -Depth 8
