# Garante pastas de log e ACL para operadores (nao apenas SYSTEM/Admin).
# Evita PermissionError ao abrir logs\api\sagra_api.log com usuario comum.
param(
    [string]$Root = "",
    [switch]$Quiet
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info([string]$Msg) {
    if (-not $Quiet) { Write-Host $Msg }
}

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logsRoot = Join-Path $Root "logs"

foreach ($sub in @("api", "sync")) {
    $dir = Join-Path $logsRoot $sub
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# S-1-5-32-545 = BUILTIN\Users (funciona em PT-BR e EN-US)
$usersSid = "*S-1-5-32-545"
$grants = @(
    @("AUTORIDADE NT\SISTEMA", "(OI)(CI)F"),
    @("BUILTIN\Administradores", "(OI)(CI)F"),
    @($usersSid, "(OI)(CI)M")
)

foreach ($pair in $grants) {
    $null = & icacls $logsRoot /grant ("{0}:{1}" -f $pair[0], $pair[1]) /T /C /Q 2>&1
}

Get-ChildItem -LiteralPath $logsRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $null = & icacls $_.FullName /grant "${usersSid}:(M)" /C /Q 2>&1
    $null = & icacls $_.FullName /grant "BUILTIN\Administradores:(F)" /C /Q 2>&1
}

Write-Info "Logs: permissoes verificadas em $logsRoot"
exit 0
