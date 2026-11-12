# Reinicia os servicos SAGRA de producao com lock do SystemWatchdog.
# Invocado de forma detached pela API (POST /api/admin/system/restart).
# Usa nssm/sc (mesmo padrao do controle admin de sync), nao Restart-Service.
#Requires -Version 5.1
param(
    [string]$Root = "",
    [string]$RequestId = "",
    [string]$StatusFile = "",
    [string]$LogFile = "",
    [string]$Reason = "reinicio via UI",
    [string]$NssmPath = "",
    [string[]]$ServiceNames = @(
        "SAGRA-SyncAndamentos",
        "SAGRA-MonitorSyncAndamentos",
        "SAGRA-OrganizadorEmailSepim",
        "SAGRA-Api"
    ),
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Continue"

function Resolve-SagraRoot([string]$Hint) {
    if ($Hint) {
        return [System.IO.Path]::GetFullPath($Hint)
    }
    if ($PSScriptRoot) {
        $scriptParent = Split-Path $PSScriptRoot -Parent
        if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
            return Split-Path $PSScriptRoot -Parent
        }
        if ((Split-Path $scriptParent -Leaf) -ieq "releases") {
            return Split-Path $scriptParent -Parent
        }
        return $PSScriptRoot
    }
    return [System.IO.Path]::GetFullPath((Get-Location).Path)
}

function Write-RestartLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff"), $Message
    try {
        if ($script:RestartLogFile) {
            Add-Content -LiteralPath $script:RestartLogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
        }
    } catch {}
    Write-Host $line
}

function Write-RestartStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Payload
    )
    try {
        $parent = Split-Path $Path -Parent
        if ($parent) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $json = ($Payload | ConvertTo-Json -Depth 8 -Compress)
        $tmp = "$Path.$PID.tmp"
        Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } catch {
        Write-RestartLog ("FALHA ao gravar status {0}: {1}" -f $Path, $_)
    }
}

function Resolve-Nssm {
    param(
        [string]$Hint,
        [string]$RootPath
    )
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($Hint) { $candidates.Add($Hint) }
    if ($env:NSSM_PATH) { $candidates.Add($env:NSSM_PATH) }
    foreach ($base in @($RootPath, (Join-Path $RootPath "current"), $PSScriptRoot)) {
        if (-not $base) { continue }
        $candidates.Add((Join-Path $base "deploy\tools\nssm.exe"))
        $candidates.Add((Join-Path $base "tools\nssm.exe"))
        $candidates.Add((Join-Path $base "nssm.exe"))
    }
    $candidates.Add("C:\nssm\nssm.exe")
    $candidates.Add("C:\Tools\nssm\nssm.exe")
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { $candidates.Add([string]$cmd.Source) }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

function Invoke-ScExe {
    param([string[]]$Args)
    $out = & sc.exe @Args 2>&1 | Out-String
    return @{
        exit = $LASTEXITCODE
        text = ($out | Out-String).Trim()
    }
}

function Get-ServiceStateName {
    param([string]$Name)
    $q = Invoke-ScExe -Args @("query", $Name)
    if ($q.exit -ne 0) {
        return @{ exists = $false; state = $null; raw = $q.text }
    }
    $state = $null
    if ($q.text -match "STATE\s*:\s*\d+\s+(\w+)") {
        $state = $Matches[1]
    }
    return @{ exists = $true; state = $state; raw = $q.text }
}

function Wait-ServiceState {
    param(
        [string]$Name,
        [string]$Wanted,
        [int]$WaitSec = 60
    )
    $deadline = (Get-Date).AddSeconds($WaitSec)
    do {
        $info = Get-ServiceStateName -Name $Name
        if ($info.exists -and $info.state -and ($info.state -ieq $Wanted)) {
            return $true
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Restart-SagraService {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Nssm,
        [int]$WaitSec = 60
    )
    $info = Get-ServiceStateName -Name $Name
    if (-not $info.exists) {
        return [pscustomobject]@{ name = $Name; ok = $false; via = "none"; detail = "servico nao instalado" }
    }

    Write-RestartLog ("Reiniciando {0} (estado={1}) via={2}" -f $Name, $info.state, $(if ($Nssm) { "nssm" } else { "sc" }))

    try {
        if ($Nssm) {
            $output = & $Nssm restart $Name 2>&1 | Out-String
            $code = $LASTEXITCODE
            $text = ($output | Out-String).Trim()
            if ($code -ne 0) {
                $lower = $text.ToLowerInvariant()
                if ($lower -match "access is denied|acesso negado") {
                    return [pscustomobject]@{
                        name = $Name
                        ok = $false
                        via = "nssm"
                        detail = "acesso negado (rode conceder-controle-servico.ps1 para a conta da API)"
                    }
                }
                return [pscustomobject]@{
                    name = $Name
                    ok = $false
                    via = "nssm"
                    detail = ("nssm restart exit={0}: {1}" -f $code, $text.Substring(0, [Math]::Min(300, $text.Length)))
                }
            }
        } else {
            $stop = Invoke-ScExe -Args @("stop", $Name)
            Start-Sleep -Seconds 1
            $start = Invoke-ScExe -Args @("start", $Name)
            if ($start.exit -ne 0) {
                $combined = ("{0}`n{1}" -f $stop.text, $start.text)
                $lower = $combined.ToLowerInvariant()
                if ($lower -match "access is denied|acesso negado") {
                    return [pscustomobject]@{
                        name = $Name
                        ok = $false
                        via = "sc"
                        detail = "acesso negado (rode conceder-controle-servico.ps1 para a conta da API)"
                    }
                }
                return [pscustomobject]@{
                    name = $Name
                    ok = $false
                    via = "sc"
                    detail = ("sc restart falhou: {0}" -f $combined.Substring(0, [Math]::Min(300, $combined.Length)))
                }
            }
        }

        $ok = Wait-ServiceState -Name $Name -Wanted "RUNNING" -WaitSec $WaitSec
        if (-not $ok) {
            $after = Get-ServiceStateName -Name $Name
            return [pscustomobject]@{
                name = $Name
                ok = $false
                via = $(if ($Nssm) { "nssm" } else { "sc" })
                detail = ("timeout aguardando RUNNING (estado={0})" -f $after.state)
            }
        }
        return [pscustomobject]@{
            name = $Name
            ok = $true
            via = $(if ($Nssm) { "nssm" } else { "sc" })
            detail = "running"
        }
    } catch {
        return [pscustomobject]@{
            name = $Name
            ok = $false
            via = $(if ($Nssm) { "nssm" } else { "sc" })
            detail = "$_"
        }
    }
}

# --- main ---
$Root = Resolve-SagraRoot -Hint $Root
if (-not $RequestId) {
    $RequestId = [guid]::NewGuid().ToString("N")
}
if (-not $StatusFile) {
    $StatusFile = Join-Path $Root "shared\run\system_restart_status.json"
}
if (-not $LogFile) {
    $LogFile = Join-Path $Root "shared\logs\system\system_restart.log"
}

$logParent = Split-Path $LogFile -Parent
if ($logParent) {
    New-Item -ItemType Directory -Path $logParent -Force | Out-Null
}
$script:RestartLogFile = $LogFile

Write-RestartLog ("=== inicio request_id={0} root={1} pid={2} reason={3} ===" -f $RequestId, $Root, $PID, $Reason)

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
if ($nssm) {
    Write-RestartLog ("nssm={0}" -f $nssm)
} else {
    Write-RestartLog "nssm nao encontrado; usando sc.exe"
}

$maintenancePath = Join-Path $Root "shared\run\system-watchdog.maintenance"
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$results = New-Object System.Collections.Generic.List[object]
$overallOk = $true

Write-RestartStatus -Path $StatusFile -Payload ([ordered]@{
    request_id = $RequestId
    phase = "running"
    ok = $null
    reason = $Reason
    started_at = $startedAt
    finished_at = $null
    services = @()
    detail = "reiniciando servicos"
    pid = $PID
    log_file = $LogFile
})

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
    Write-RestartLog ("maintenance lock: {0}" -f $maintenancePath)

    foreach ($name in $ServiceNames) {
        Write-RestartLog ("--- processando {0} ---" -f $name)
        $result = Restart-SagraService -Name $name -Nssm $nssm -WaitSec $TimeoutSec
        [void]$results.Add($result)
        Write-RestartLog ("resultado {0}: ok={1} via={2} detail={3}" -f $result.name, $result.ok, $result.via, $result.detail)
        if (-not $result.ok) {
            $overallOk = $false
        }
        Write-RestartStatus -Path $StatusFile -Payload ([ordered]@{
            request_id = $RequestId
            phase = "running"
            ok = $null
            reason = $Reason
            started_at = $startedAt
            finished_at = $null
            services = @($results.ToArray())
            detail = ("processando {0}" -f $name)
            pid = $PID
            log_file = $LogFile
        })
    }
} catch {
    $overallOk = $false
    [void]$results.Add([pscustomobject]@{ name = "_script"; ok = $false; via = "script"; detail = "$_" })
    Write-RestartLog ("ERRO FATAL: {0}" -f $_)
} finally {
    Remove-Item -LiteralPath $maintenancePath -Force -ErrorAction SilentlyContinue
    $finishedAt = (Get-Date).ToUniversalTime().ToString("o")
    $detail = if ($overallOk) { "reinicio concluido" } else { "reinicio concluido com falhas" }
    Write-RestartStatus -Path $StatusFile -Payload ([ordered]@{
        request_id = $RequestId
        phase = "done"
        ok = $overallOk
        reason = $Reason
        started_at = $startedAt
        finished_at = $finishedAt
        services = @($results.ToArray())
        detail = $detail
        pid = $PID
        log_file = $LogFile
    })
    Write-RestartLog ("=== fim ok={0} detail={1} ===" -f $overallOk, $detail)
}

if ($overallOk) { exit 0 } else { exit 1 }
