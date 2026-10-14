param([string]$Root = "")
$ErrorActionPreference = "Stop"
if (-not $Root) {
    $scriptParent = Split-Path $PSScriptRoot -Parent
    $Root = if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        Split-Path $PSScriptRoot -Parent
    } elseif ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        Split-Path $scriptParent -Parent
    } else { $PSScriptRoot }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$path = Join-Path $Root "shared\run\system-watchdog.maintenance"
Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $path) {
    throw "Nao foi possivel remover o lock de manutencao: $path"
}
Write-Host "Watchdog retomado. O grace period sera aplicado antes de qualquer recuperacao."
exit 0

