# Para a API SAGRA na porta indicada (requer Administrador para processos de servico/NSSM).
param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [switch]$Quiet
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info([string]$Msg) {
    if (-not $Quiet) { Write-Host $Msg }
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ListenerPids([int]$ListenPort) {
    $found = [System.Collections.Generic.HashSet[int]]::new()
    try {
        Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction Stop | ForEach-Object {
            if ($_.OwningProcess -gt 0) { [void]$found.Add([int]$_.OwningProcess) }
        }
    } catch {
        netstat -ano | Select-String ":$ListenPort\s" | Select-String "LISTENING|OUVINDO" | ForEach-Object {
            $parts = ($_.Line -replace '\s+', ' ').Trim().Split(' ')
            $pidStr = $parts[-1]
            if ($pidStr -match '^\d+$') {
                $n = [int]$pidStr
                if ($n -gt 0) { [void]$found.Add($n) }
            }
        }
    }
    return @($found)
}

function Get-ProcInfo([int]$ProcId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Stop-ProcessTree([int]$ProcId) {
    if ($ProcId -le 0) { return }
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcId" -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-ProcessTree -ProcId $_.ProcessId
    }
    Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
    & taskkill.exe /F /PID $ProcId /T 2>$null | Out-Null
}

function Test-IsSyncOrWatchdogService($svc) {
    $blob = "$($svc.Name) $($svc.DisplayName)"
    return $blob -match '(?i)SyncAndamentos|Watchdog'
}

function Stop-SagraApiServices {
    # Nunca para SAGRA-SyncAndamentos nem watchdog. So servicos da API (uvicorn/NSSM web).
    $stopped = $false
    Get-Service -ErrorAction SilentlyContinue | Where-Object {
        $_.Status -eq 'Running' -and (
            $_.Name -match '(?i)sagra' -or
            $_.DisplayName -match '(?i)sagra'
        )
    } | ForEach-Object {
        if (Test-IsSyncOrWatchdogService $_) {
            Write-Info "Mantendo servico (sync/watchdog): $($_.Name) ($($_.DisplayName))"
            return
        }
        Write-Info "Parando servico Windows (API): $($_.Name) ($($_.DisplayName))"
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        $stopped = $true
    }
    if ($stopped) { Start-Sleep -Seconds 2 }
}

function Stop-UvicornProcesses {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -match 'routers\.api:app|uvicorn.*routers\.api'
    } | ForEach-Object {
        Write-Info "Encerrando uvicorn PID $($_.ProcessId): $($_.Name)"
        Stop-ProcessTree -ProcId $_.ProcessId
    }
}

if (-not (Test-IsAdmin)) {
    Write-Host "[ERRO] parar-api.ps1 requer Administrador." -ForegroundColor Red
    exit 2
}

Write-Info "Parando SAGRA Web na porta $Port..."

Stop-SagraApiServices
Stop-UvicornProcesses

foreach ($procId in (Get-ListenerPids -ListenPort $Port)) {
    $info = Get-ProcInfo -ProcId $procId
    if ($info) {
        $cmd = $info.CommandLine
        if ($cmd -and $cmd.Length -gt 100) { $cmd = $cmd.Substring(0, 97) + "..." }
        $label = if ($cmd) { "$($info.Name) $cmd" } else { $info.Name }
        Write-Info "Encerrando listener PID ${procId}: $label"

        $parentId = [int]$info.ParentProcessId
        $parent = Get-ProcInfo -ProcId $parentId
        if ($parent -and $parent.Name -ieq 'nssm.exe') {
            Write-Info ("  Processo gerenciado por NSSM (PID pai $parentId) - encerrando arvore")
            Stop-ProcessTree -ProcId $parentId
        }
    } else {
        Write-Info "Encerrando listener PID $procId"
    }
    Stop-ProcessTree -ProcId $procId
}

Start-Sleep -Seconds 1

$remaining = Get-ListenerPids -ListenPort $Port
if ($remaining.Count -gt 0) {
    Write-Host ""
    Write-Host "[ERRO] Porta $Port ainda em uso (PIDs: $($remaining -join ', '))." -ForegroundColor Red
    foreach ($procId in $remaining) {
        $info = Get-ProcInfo -ProcId $procId
        if ($info) {
            $detail = "{0} -- {1}" -f $info.Name, $info.CommandLine
            Write-Host ("  PID ${procId}: $detail") -ForegroundColor Yellow
        }
    }
    netstat -ano | Select-String ":$Port "
    exit 1
}

Write-Info "Porta $Port livre."
exit 0
