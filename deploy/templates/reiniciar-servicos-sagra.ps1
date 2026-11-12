# Reinicia os servicos SAGRA de producao com lock do SystemWatchdog.
# Invocado de forma detached pela API (POST /api/admin/system/restart).
#Requires -Version 5.1
param(
    [string]$Root = "",
    [string]$RequestId = "",
    [string]$StatusFile = "",
    [string]$Reason = "reinicio via UI",
    [string[]]$ServiceNames = @(
        "SAGRA-SyncAndamentos",
        "SAGRA-MonitorSyncAndamentos",
        "SAGRA-OrganizadorEmailSepim",
        "SAGRA-Api"
    ),
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"

function Resolve-SagraRoot([string]$Hint) {
    if ($Hint) {
        return [System.IO.Path]::GetFullPath($Hint)
    }
    $scriptParent = Split-Path $PSScriptRoot -Parent
    if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        return Split-Path $PSScriptRoot -Parent
    }
    if ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        return Split-Path $scriptParent -Parent
    }
    return $PSScriptRoot
}

function Write-RestartStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Payload
    )
    $parent = Split-Path $Path -Parent
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $json = ($Payload | ConvertTo-Json -Depth 6 -Compress)
    $tmp = "$Path.$PID.tmp"
    Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Restart-SagraService {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$WaitSec = 60
    )
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $service) {
        return @{ name = $Name; ok = $false; detail = "servico nao instalado" }
    }
    try {
        if ($service.Status -eq "Running") {
            Restart-Service -Name $Name -Force -ErrorAction Stop
        } else {
            $service.Refresh()
            if ($service.Status -eq "Stopped") {
                Start-Service -Name $Name -ErrorAction Stop
            } else {
                Restart-Service -Name $Name -Force -ErrorAction Stop
            }
        }
        $service.WaitForStatus("Running", [TimeSpan]::FromSeconds($WaitSec))
        return @{ name = $Name; ok = $true; detail = "running" }
    } catch {
        return @{ name = $Name; ok = $false; detail = "$_" }
    }
}

$Root = Resolve-SagraRoot -Hint $Root
if (-not $RequestId) {
    $RequestId = [guid]::NewGuid().ToString("N")
}
if (-not $StatusFile) {
    $StatusFile = Join-Path $Root "shared\run\system_restart_status.json"
}

$maintenancePath = Join-Path $Root "shared\run\system-watchdog.maintenance"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$results = @()
$overallOk = $true

Write-RestartStatus -Path $StatusFile -Payload @{
    request_id = $RequestId
    phase = "running"
    ok = $null
    reason = $Reason
    started_at = $startedAt
    finished_at = $null
    services = @()
    detail = "reiniciando servicos"
    pid = $PID
}

try {
    New-Item -ItemType Directory -Path (Split-Path $maintenancePath -Parent) -Force | Out-Null
    $lockPayload = [ordered]@{
        owner = "ui-restart"
        reason = $Reason
        request_id = $RequestId
        pid = $PID
        created_at = $startedAt
    } | ConvertTo-Json -Compress
    $lockTmp = "$maintenancePath.$PID.tmp"
    Set-Content -LiteralPath $lockTmp -Value $lockPayload -Encoding UTF8
    Move-Item -LiteralPath $lockTmp -Destination $maintenancePath -Force

    foreach ($name in $ServiceNames) {
        $result = Restart-SagraService -Name $name -WaitSec $TimeoutSec
        $results += $result
        if (-not $result.ok) {
            $overallOk = $false
        }
        Write-RestartStatus -Path $StatusFile -Payload @{
            request_id = $RequestId
            phase = "running"
            ok = $null
            reason = $Reason
            started_at = $startedAt
            finished_at = $null
            services = $results
            detail = ("processando {0}" -f $name)
            pid = $PID
        }
    }
} catch {
    $overallOk = $false
    $results += @{ name = "_script"; ok = $false; detail = "$_" }
} finally {
    Remove-Item -LiteralPath $maintenancePath -Force -ErrorAction SilentlyContinue
    $finishedAt = (Get-Date).ToUniversalTime().ToString("o")
    $detail = if ($overallOk) { "reinicio concluido" } else { "reinicio concluido com falhas" }
    Write-RestartStatus -Path $StatusFile -Payload @{
        request_id = $RequestId
        phase = "done"
        ok = $overallOk
        reason = $Reason
        started_at = $startedAt
        finished_at = $finishedAt
        services = $results
        detail = $detail
        pid = $PID
    }
}

if ($overallOk) { exit 0 } else { exit 1 }
