#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$inner = Join-Path $PSScriptRoot "deploy\scripts\publicar-release-prod.ps1"
if (-not (Test-Path -LiteralPath $inner)) {
    throw "Script nao encontrado: $inner"
}
& $inner @args
exit $LASTEXITCODE
