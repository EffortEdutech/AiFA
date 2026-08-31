$ErrorActionPreference = "Stop"

$CentralGraphify = "C:\Users\user\Documents\00 AI agent\scripts\graphify.ps1"

if (-not (Test-Path -LiteralPath $CentralGraphify)) {
    throw "Central Graphify wrapper not found at $CentralGraphify"
}

& $CentralGraphify @args
exit $LASTEXITCODE
