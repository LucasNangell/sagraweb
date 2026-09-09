# Para o servico SAGRA-MonitorSyncAndamentos (NSSM / SCM).
param(
    [string]$ServiceName = "SAGRA-MonitorSyncAndamentos",
    [string]$NssmPath = "",
    [string]$Root = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Execute este script como Administrador."
    }
}

function Resolve-Nssm([string]$Hint, [string]$RootPath) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    if ($RootPath) {
        $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
        $candidates += (Join-Path $RootPath "tools\nssm.exe")
    }
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Servico '$ServiceName' nao encontrado."
    exit 0
}

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
Write-Host "Parando $ServiceName (status atual: $($svc.Status))..."

if ($nssm) {
    & $nssm stop $ServiceName
} else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}

$deadline = (Get-Date).AddSeconds(15)
do {
    Start-Sleep -Milliseconds 500
    $svc.Refresh()
} while ($svc.Status -ne "Stopped" -and (Get-Date) -lt $deadline)

$svc.Refresh()
if ($svc.Status -ne "Stopped" -and $Force) {
    Write-Host "Ainda nao parou - forcando via taskkill..."
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match "monitor_sync_andamentos_service\.py" } |
        ForEach-Object {
            Write-Host "Kill PID $($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Seconds 1
    $svc.Refresh()
}

Write-Host "Status final: $($svc.Status)"
exit 0
