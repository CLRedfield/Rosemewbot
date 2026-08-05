$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$electronPackage = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "node_modules\electron\package.json") | ConvertFrom-Json
$version = $electronPackage.version
$downloadUrl = "https://mirrors.huaweicloud.com/electron/$version/electron-v$version-win32-x64.zip"
$head = Invoke-WebRequest -UseBasicParsing -Method Head -Uri $downloadUrl -TimeoutSec 30
$totalBytes = [long]$head.Headers["Content-Length"]
$chunkCount = 16
$chunkSize = [Math]::Ceiling($totalBytes / $chunkCount)
$chunkDir = Join-Path $env:TEMP "electron-$version-huawei-chunks"

New-Item -ItemType Directory -Force -Path $chunkDir | Out-Null
$processes = @()

for ($index = 0; $index -lt $chunkCount; $index++) {
    $start = [long]($index * $chunkSize)
    $end = [Math]::Min($totalBytes - 1, [long](($index + 1) * $chunkSize - 1))
    $chunkPath = Join-Path $chunkDir ("chunk-{0:D2}.bin" -f $index)
    $arguments = @(
        "-L", "--fail", "--retry", "4", "--retry-delay", "2",
        "--range", "$start-$end", "--output", $chunkPath, $downloadUrl
    )
    $processes += Start-Process -FilePath "curl.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

Wait-Process -Id $processes.Id
foreach ($downloadProcess in $processes) {
    $downloadProcess.Refresh()
    if ($downloadProcess.ExitCode -ne 0) {
        throw "Electron chunk process $($downloadProcess.Id) failed with exit code $($downloadProcess.ExitCode)."
    }
}

$zipPath = Join-Path $env:TEMP "electron-v$version-win32-x64-parallel-huawei.zip"
$targetStream = [System.IO.File]::Create($zipPath)
try {
    for ($index = 0; $index -lt $chunkCount; $index++) {
        $chunkPath = Join-Path $chunkDir ("chunk-{0:D2}.bin" -f $index)
        $sourceStream = [System.IO.File]::OpenRead($chunkPath)
        try {
            $sourceStream.CopyTo($targetStream)
        } finally {
            $sourceStream.Dispose()
        }
    }
} finally {
    $targetStream.Dispose()
}

$actualBytes = (Get-Item -LiteralPath $zipPath).Length
if ($actualBytes -ne $totalBytes) {
    throw "Combined archive length $actualBytes did not match expected $totalBytes."
}

$packagePath = (Resolve-Path -LiteralPath (Join-Path $projectRoot "node_modules\electron")).Path
$electronDist = Join-Path $packagePath "dist"
New-Item -ItemType Directory -Force -Path $electronDist | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $electronDist -Force
[System.IO.File]::WriteAllText((Join-Path $packagePath "path.txt"), "electron.exe")

if (-not (Test-Path -LiteralPath (Join-Path $electronDist "electron.exe"))) {
    throw "Electron executable missing after extraction."
}

Write-Output "Installed Electron $version from $chunkCount parallel chunks."
