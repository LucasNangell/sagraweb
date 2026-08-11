# Status do servico SAGRA-SyncAndamentos + idade do heartbeat + tail do log.
param(
    [string]$Root = "",
    [string]$ServiceName = "SAGRA-SyncAndamentos",
    [int]$LogLines = 20,
    [int]$StaleSeconds = 180
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logDir = Join-Path $Root "logs\sync"
$hbPath = Join-Path $logDir "sync_heartbeat.json"
$mainLog = Join-Path $logDir "sync_andamentos.log"

Write-Host "==== SAGRA Sync Andamentos - Status ===="
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
    if ($svc.Status -eq "Paused") {
        Write-Host ""
        Write-Host "AVISO: Status Paused = processo saiu rapido e NSSM entrou em throttle."
        Write-Host "Veja service_stderr.log abaixo e rode: .\instalar-servico-sync.ps1 -Start"
    }
}

$stderrLog = Join-Path $logDir "service_stderr.log"
$stdoutLog = Join-Path $logDir "service_stdout.log"

Write-Host ""
Write-Host "---- Heartbeat ----"
if (-not (Test-Path -LiteralPath $hbPath)) {
    Write-Host "Arquivo ausente: $hbPath"
} else {
    try {
        $hb = Get-Content -LiteralPath $hbPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $written = $null
        if ($hb.written_at) {
            try { $written = [datetime]::Parse($hb.written_at).ToUniversalTime() } catch {}
        }
        $age = $null
        if ($written) {
            $age = [math]::Round(((Get-Date).ToUniversalTime() - $written).TotalSeconds, 1)
        }
        Write-Host "PID:                 $($hb.pid)"
        Write-Host "started_at:          $($hb.started_at)"
        Write-Host "last_cycle_at:       $($hb.last_cycle_at)"
        Write-Host "phase:               $($hb.phase)"
        Write-Host "cycles:              $($hb.cycles)"
        Write-Host "consecutive_errors:  $($hb.consecutive_errors)"
        Write-Host "last_error:          $($hb.last_error)"
        Write-Host "stall_seconds:       $($hb.stall_seconds)"
        Write-Host "written_at:          $($hb.written_at)"
        if ($null -ne $age) {
            $staleMark = if ($age -gt $StaleSeconds) { " STALE!" } else { " OK" }
            Write-Host "heartbeat_age_sec:   $age$staleMark  (limite=$StaleSeconds)"
        }
    } catch {
        Write-Host "Falha ao ler heartbeat: $_"
    }
}

Write-Host ""
Write-Host "---- Ultimas $LogLines linhas de sync_andamentos.log ----"
if (Test-Path -LiteralPath $mainLog) {
    Get-Content -LiteralPath $mainLog -Tail $LogLines -ErrorAction SilentlyContinue
} else {
    Write-Host "Log ausente: $mainLog"
}

Write-Host ""
Write-Host "---- Ultimas 15 linhas de service_stderr.log ----"
if (Test-Path -LiteralPath $stderrLog) {
    Get-Content -LiteralPath $stderrLog -Tail 15 -ErrorAction SilentlyContinue
} else {
    Write-Host "Log ausente: $stderrLog"
}

Write-Host ""
Write-Host "==== Fim ===="
exit 0
