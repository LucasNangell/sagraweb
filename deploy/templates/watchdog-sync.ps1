# Watchdog externo (2a camada): verifica servico + heartbeat e reinicia se necessario.
# Projetado para rodar como Tarefa Agendada (SYSTEM) a cada 2 minutos.
param(
    [string]$Root = "",
    [string]$ServiceName = "SAGRA-SyncAndamentos",
    [string]$NssmPath = "",
    [int]$StaleSeconds = 180,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$logDir = Join-Path $Root "logs\sync"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$watchLog = Join-Path $logDir "watchdog_external.log"
$hbPath = Join-Path $logDir "sync_heartbeat.json"

function Write-WatchLog([string]$Msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Msg
    Add-Content -LiteralPath $watchLog -Value $line -Encoding UTF8
    Write-Host $line
}

function Resolve-Nssm([string]$Hint, [string]$RootPath) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
    $candidates += (Join-Path $RootPath "tools\nssm.exe")
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

function Restart-SyncService([string]$Reason) {
    Write-WatchLog "RESTART: $Reason"
    if ($DryRun) {
        Write-WatchLog "DryRun=true - nao reiniciando"
        return
    }
    $nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
    try {
        if ($nssm) {
            & $nssm restart $ServiceName
        } else {
            Restart-Service -Name $ServiceName -Force -ErrorAction Stop
        }
        Write-WatchLog "Restart solicitado com sucesso"
    } catch {
        Write-WatchLog "Falha ao reiniciar: $_"
        try {
            Start-Service -Name $ServiceName -ErrorAction Stop
            Write-WatchLog "Start-Service ok (fallback)"
        } catch {
            Write-WatchLog "Start-Service falhou: $_"
        }
    }
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-WatchLog "Servico '$ServiceName' nao instalado - nada a fazer"
    exit 0
}

if ($svc.Status -ne "Running") {
    Write-WatchLog "Servico status=$($svc.Status) - iniciando"
    if (-not $DryRun) {
        try {
            $nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
            if ($nssm) {
                & $nssm start $ServiceName
            } else {
                Start-Service -Name $ServiceName -ErrorAction Stop
            }
            Write-WatchLog "Start solicitado"
        } catch {
            Write-WatchLog "Falha ao iniciar: $_"
            exit 1
        }
    }
    exit 0
}

# Servico Running - valida heartbeat
if (-not (Test-Path -LiteralPath $hbPath)) {
    Write-WatchLog "Heartbeat ausente com servico Running - aguardando proximo ciclo (sem restart)"
    exit 0
}

try {
    $hb = Get-Content -LiteralPath $hbPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-WatchLog "Heartbeat invalido: $_ - reiniciando"
    Restart-SyncService "heartbeat JSON invalido"
    exit 0
}

$ref = $null
if ($hb.last_cycle_at) {
    try { $ref = [datetime]::Parse($hb.last_cycle_at).ToUniversalTime() } catch {}
}
if (-not $ref -and $hb.written_at) {
    try { $ref = [datetime]::Parse($hb.written_at).ToUniversalTime() } catch {}
}

if (-not $ref) {
    Write-WatchLog "Heartbeat sem timestamps utilizaveis - reiniciando"
    Restart-SyncService "heartbeat sem last_cycle_at/written_at"
    exit 0
}

$age = ((Get-Date).ToUniversalTime() - $ref).TotalSeconds
if ($age -gt $StaleSeconds) {
    Restart-SyncService ("heartbeat velho: age={0:N0}s limite={1}s phase={2}" -f $age, $StaleSeconds, $hb.phase)
    exit 0
}

Write-WatchLog ("OK service=Running heartbeat_age={0:N0}s phase={1} cycles={2}" -f $age, $hb.phase, $hb.cycles)
exit 0
