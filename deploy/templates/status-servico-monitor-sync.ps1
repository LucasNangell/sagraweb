# Status do servico SAGRA-MonitorSyncAndamentos + JSON de divergencia + tail do log.
param(
    [string]$Root = "",
    [string]$ServiceName = "SAGRA-MonitorSyncAndamentos",
    [int]$LogLines = 20,
    [int]$StaleSeconds = 300
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logDir = Join-Path $Root "logs\sync"
$statusPath = Join-Path $logDir "sync_divergencia_monitor.json"
$mainLog = Join-Path $logDir "monitor_sync_andamentos.log"
$stderrLog = Join-Path $logDir "monitor_service_stderr.log"

Write-Host "==== SAGRA Monitor Sync Andamentos - Status ===="
Write-Host "Root: $Root"
Write-Host "LogDir: $logDir"
Write-Host ""

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Servico: NAO INSTALADO ($ServiceName)"
} else {
    Write-Host "Servico: $($svc.Status)  StartType=$($svc.StartType)"
    try {
        $cim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
        Write-Host "ProcessId: $($cim.ProcessId)"
        Write-Host "PathName:  $($cim.PathName)"
    } catch {}
}

Write-Host ""
Write-Host "---- Status JSON (divergencia) ----"
if (-not (Test-Path -LiteralPath $statusPath)) {
    Write-Host "Arquivo ausente: $statusPath"
} else {
    try {
        $st = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "PID:          $($st.pid)"
        Write-Host "phase:        $($st.phase)"
        Write-Host "alert:        $($st.alert)"
        Write-Host "diverged:     $($st.diverged)"
        Write-Host "count_mdb:    $($st.count_mdb) (os=$($st.count_mdb_os) pap=$($st.count_mdb_papelaria))"
        Write-Host "count_mysql:  $($st.count_mysql)"
        Write-Host "checked_at:   $($st.checked_at)"
        $checked = $null
        if ($st.checked_at) {
            try { $checked = [datetime]::Parse($st.checked_at).ToUniversalTime() } catch {}
        }
        if ($checked) {
            $age = [math]::Round(((Get-Date).ToUniversalTime() - $checked).TotalSeconds, 1)
            $mark = if ($age -gt $StaleSeconds) { " STALE!" } else { " OK" }
            Write-Host "age_sec:      $age$mark  (limite=$StaleSeconds)"
        }
    } catch {
        Write-Host "Falha ao ler status: $_"
    }
}

Write-Host ""
Write-Host "---- Ultimas $LogLines linhas de monitor_sync_andamentos.log ----"
if (Test-Path -LiteralPath $mainLog) {
    Get-Content -LiteralPath $mainLog -Tail $LogLines -ErrorAction SilentlyContinue
} else {
    Write-Host "Log ausente: $mainLog"
}

Write-Host ""
Write-Host "---- Ultimas 15 linhas de monitor_service_stderr.log ----"
if (Test-Path -LiteralPath $stderrLog) {
    Get-Content -LiteralPath $stderrLog -Tail 15 -ErrorAction SilentlyContinue
} else {
    Write-Host "Log ausente: $stderrLog"
}

Write-Host ""
Write-Host "==== Fim ===="
exit 0
