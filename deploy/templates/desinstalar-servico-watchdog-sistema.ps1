param(
    [string]$ServiceName = "SAGRA-SystemWatchdog",
    [string]$NssmPath = ""
)
$ErrorActionPreference = "Stop"
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script como Administrador."
}
if ($ServiceName -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw "ServiceName invalido." }
$nssm = $NssmPath
if (-not $nssm) {
    foreach ($candidate in @(
        (Join-Path $PSScriptRoot "deploy\tools\nssm.exe"),
        (Join-Path $PSScriptRoot "tools\nssm.exe"),
        (Join-Path (Split-Path $PSScriptRoot -Parent) "deploy\tools\nssm.exe")
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nssm = $candidate; break }
    }
}
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Servico nao instalado: $ServiceName"
    exit 0
}
if ($nssm -and (Test-Path -LiteralPath $nssm -PathType Leaf)) {
    & $nssm stop $ServiceName | Out-Null
    & $nssm remove $ServiceName confirm | Out-Null
} else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & "$env:SystemRoot\System32\sc.exe" delete $ServiceName | Out-Null
}
Write-Host "Servico removido: $ServiceName. Logs e estado foram preservados."
exit 0
