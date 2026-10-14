param(
    [string]$Root = "",
    [string]$ServiceName = "SAGRA-SystemWatchdog",
    [int]$LogLines = 30
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not $Root) {
    $scriptParent = Split-Path $PSScriptRoot -Parent
    $Root = if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        Split-Path $PSScriptRoot -Parent
    } elseif ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        Split-Path $scriptParent -Parent
    } else { $PSScriptRoot }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logDir = Join-Path $Root "shared\logs\system"
$statusPath = Join-Path $Root "shared\run\system_watchdog_status.json"
$statePath = Join-Path $Root "shared\run\system_watchdog_state.json"
$maintenancePath = Join-Path $Root "shared\run\system-watchdog.maintenance"

if ($ServiceName -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw "ServiceName invalido." }

Write-Host "==== SAGRA System Watchdog ===="
Write-Host "Root: $Root"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Servico: $($svc.Status)  StartType=$($svc.StartType)"
    try {
        $cim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
        Write-Host "Conta:   $($cim.StartName)"
        Write-Host "PID:     $($cim.ProcessId)"
    } catch {}
} else {
    Write-Host "Servico: NAO INSTALADO ($ServiceName)"
}

Write-Host "Manutencao: $(if (Test-Path -LiteralPath $maintenancePath) { 'ATIVA (ou lock stale)' } else { 'nao' })"
$legacyTask = Get-ScheduledTask -TaskName "SAGRA-SyncAndamentos-Watchdog" -ErrorAction SilentlyContinue
if ($legacyTask -and $legacyTask.State -ne "Disabled") {
    Write-Host "AVISO: watchdog legado ainda ativo ($($legacyTask.State)); reinstale este servico com -Start para evitar dois controladores."
}
if (Test-Path -LiteralPath $statusPath) {
    try {
        $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "CheckedAt: $($status.checked_at)"
        try {
            $statusAge = ((Get-Date).ToUniversalTime() - [datetime]::Parse([string]$status.checked_at).ToUniversalTime()).TotalSeconds
            if ($statusAge -gt 60) { Write-Host "AVISO: status stale (${statusAge}s)" }
        } catch { Write-Host "AVISO: checked_at invalido" }
        Write-Host "Overall:   $($status.overall)"
        Write-Host "Version:   $($status.version)  sha256=$($status.code_sha256)"
        Write-Host "API:       live=$($status.api.liveness.ok) ready=$($status.api.readiness.ok) recovery=$($status.api.recovery.phase)"
        Write-Host "Sync:      service=$($status.sync.service.status) heartbeat=$($status.sync.heartbeat.phase) age=$($status.sync.heartbeat.age_seconds)s recovery=$($status.sync.recovery.phase)"
    } catch {
        Write-Host "Status JSON invalido: $_"
    }
} else {
    Write-Host "Status: arquivo ausente ($statusPath)"
}

Write-Host ""
Write-Host "---- Log ----"
Get-Content -LiteralPath (Join-Path $logDir "system_watchdog.log") -Tail $LogLines -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Estado persistente: $statePath"
exit 0

