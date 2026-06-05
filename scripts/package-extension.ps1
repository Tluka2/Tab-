$ErrorActionPreference = "Stop"

node scripts\verify-extension.mjs

$releaseDir = Join-Path (Get-Location) "release"
$zipPath = Join-Path $releaseDir "tab-edge-extension.zip"

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path "extension\*" -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "PASS packaged extension: $zipPath"
