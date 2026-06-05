$ErrorActionPreference = "Stop"

$env:SMOKE_BROWSER = "edge"

node scripts\verify-extension.mjs
node scripts\smoke-browser.mjs
node scripts\smoke-functional.mjs
node scripts\smoke-extension-load.mjs
node scripts\smoke-performance.mjs

Write-Host "PASS Edge smoke suite"
