#Requires -Version 5.1
<#
.SYNOPSIS
  Script unico PROD: junctions, parar API (se necessario), ativar release, corrigir config, subir API, health check,
  reiniciar SystemWatchdog, Sync andamentos e Monitor (tudo com o lock de manutencao do watchdog ativo).

  Executar NO SERVIDOR 10.1.1.73:

    cd "C:\Sistemas CGraf\Sagra Web"
    .\publicar-release.bat -ReleaseName "20260611_201054" -ConfirmProductionSwitch

.USAGE
  powershell -File deploy\scripts\publicar-release-prod.ps1 `
    -ReleaseName "20260611_201054" -ConfirmProductionSwitch
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseName,
    [string]$ProdPath = "",
    [switch]$ConfirmProductionSwitch,
    [switch]$InteractiveApi,
    [int]$HealthWaitSec = 60
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

if (-not $ConfirmProductionSwitch) {
    throw "Use -ConfirmProductionSwitch (aceita ~1-3 min sem API durante a troca)."
}

$ProdPath = Resolve-DeployProdPath -ProdPath $ProdPath
Assert-SafeReleaseName -ReleaseName $ReleaseName
$layout = Get-ReleaseLayoutPaths $ProdPath
$targetRelease = Join-Path $layout.Releases $ReleaseName
$currentRoot = Join-Path $ProdPath "current"
$port = Get-SagraApiPort -ProdPath $ProdPath
$activeNow = Get-ActiveReleaseName $ProdPath

Write-DeployStep "Publicar release - SAGRA Web (PROD)"
Write-Host "Servidor:       $ProdPath"
Write-Host "Release alvo:   $ReleaseName"
Write-Host "Release ativa:  $(if ($activeNow) { $activeNow } else { '(nenhuma)' })"
Write-Host "Porta API:      $port"
Write-Host ""

if (-not (Test-Path -LiteralPath $targetRelease)) {
    throw "Release nao encontrada: $targetRelease`nRode deploy-release-dev.bat na maquina DEV primeiro."
}

if (-not (Test-IsDeployAdmin)) {
    Write-Host "AVISO: PowerShell nao esta como Administrador." -ForegroundColor Yellow
    Write-Host "        Se parar-api falhar, abra PowerShell como Admin e repita." -ForegroundColor Yellow
    Write-Host ""
}

# Config persistente: falta aqui deixa a release com junctions pendentes. Falha antes
# de tocar na API atual.
$missingShared = @(".env", "config.json", "vapid.json") | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $layout.Shared "config\$_") -PathType Leaf)
}
if ($missingShared) {
    throw ("Ausente em $($layout.Shared)\config: $($missingShared -join ', '). API atual preservada. " +
        "Restaure os arquivos (vapid.json: copia do DEV config\vapid.json ou backups\releases) e repita.")
}

# 1) Junctions + validacao da release
Write-DeployStep "1/6 Junctions e validacao"
& (Join-Path $PSScriptRoot "finish-release-junctions.ps1") -ProdLocalPath $ProdPath -ReleaseName $ReleaseName
if ($LASTEXITCODE -ne 0) { throw "Junctions falharam" }

# Validacao funcional no MESMO python do PATH usado pelos launchers da API.
# Deve falhar antes de parar a API atual ou alterar current.
Write-DeployStep "Preflight TIFF no Python de producao"
$tiffCheck = Join-Path $targetRelease "check_tiff_runtime.py"
if (-not (Test-Path -LiteralPath $tiffCheck)) {
    throw "Release sem preflight TIFF. Gere novamente pelo deploy-release-dev.bat."
}
$previousPythonPath = $env:PYTHONPATH
try {
    $env:PYTHONPATH = @(
        (Join-Path $targetRelease "python_pkgs"),
        (Join-Path $targetRelease "app\backend"),
        (Join-Path $targetRelease "app\services")
    ) -join ";"
    & python $tiffCheck --release-root $targetRelease
    if ($LASTEXITCODE -ne 0) { throw "Preflight TIFF falhou; API atual preservada. Verifique o erro acima." }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}

$maintenanceEntered = $false
try {
    $null = Enter-SystemWatchdogMaintenance -ProdPath $ProdPath -Reason "publicar release $ReleaseName"
    $maintenanceEntered = $true

    # 2) Parar API somente se porta em uso
    Write-DeployStep "2/6 Parar API (se necessario)"
    if (Test-SagraPortListening -Port $port) {
        Write-Host "Porta $port em uso - parando API..."
        Stop-SagraApiForDeploy -ProdPath $ProdPath -FreePortTimeoutSec 5
        Start-Sleep -Seconds 1
        if (Test-SagraPortListening -Port $port) {
            throw "Porta $port ainda em uso. Execute parar-api.bat como Administrador."
        }
        Write-DeployOk "Porta $port livre"
    } else {
        Write-DeployOk "Porta $port ja estava livre - API nao estava rodando"
    }

    # 3) Ativar current -> release
    Write-DeployStep "3/6 Ativar current"
    & (Join-Path $PSScriptRoot "activate-release.ps1") `
        -ReleaseName $ReleaseName `
        -ProdPath $ProdPath `
        -ConfirmProductionSwitch `
        -SkipHealthCheck

    # 4) Config shared -> release + remover BOM
    Write-DeployStep "4/6 Config (shared + sem BOM)"
    Connect-ReleaseToShared -ReleasePath $targetRelease -SharedRoot $layout.Shared -ProdLocalPath $ProdPath | Out-Null
    Repair-DeployConfigBom -ProdPath $ProdPath -ReleaseName $ReleaseName

    # 5) Subir API
    Write-DeployStep "5/6 Iniciar API em current\"
    Start-SagraApiForDeploy -CurrentRoot $currentRoot -InteractiveApi:$InteractiveApi

    # 6) Health check
    Write-DeployStep "6/6 Health check"
    $health = Wait-SagraHealthCheck -ProdPath $ProdPath -TimeoutSec $HealthWaitSec
    if (-not $health.Ok) {
        Write-DeployErr "Health falhou: $($health.Body)"
        Write-Host "  Logs: $currentRoot\logs\api\uvicorn_stderr.log" -ForegroundColor Yellow
        if ($activeNow -and $activeNow -ne $ReleaseName) {
            Write-DeployStep "Rollback automatico para $activeNow"
            try {
                if (Test-SagraPortListening -Port $port) {
                    Stop-SagraApiForDeploy -ProdPath $ProdPath -FreePortTimeoutSec 10
                }
                $rollbackPath = Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $activeNow -ConfirmProductionSwitch
                Connect-ReleaseToShared -ReleasePath $rollbackPath -SharedRoot $layout.Shared -ProdLocalPath $ProdPath | Out-Null
                Repair-DeployConfigBom -ProdPath $ProdPath -ReleaseName $activeNow
                Start-SagraApiForDeploy -CurrentRoot $currentRoot
                $rollbackHealth = Wait-SagraHealthCheck -ProdPath $ProdPath -TimeoutSec $HealthWaitSec
                if ($rollbackHealth.Ok) {
                    Write-DeployLog -ProdPath $ProdPath -Level "WARN" -Message "Release $ReleaseName falhou health; rollback automatico para $activeNow OK"
                } else {
                    Write-DeployLog -ProdPath $ProdPath -Level "ERROR" -Message "Release $ReleaseName falhou e health do rollback $activeNow tambem falhou: $($rollbackHealth.Body)"
                }
            } catch {
                Write-DeployLog -ProdPath $ProdPath -Level "ERROR" -Message "Falha no rollback automatico para ${activeNow}: $_"
            }
        } else {
            Write-DeployWarn "Sem release anterior conhecida para rollback automatico."
        }
        exit 1
    }
    Write-DeployOk "Health: $($health.Body)"

    # Atualiza o processo do watchdog para o codigo da nova release enquanto o
    # lock de manutencao ainda esta ativo. Ausencia do servico nao bloqueia deploy.
    $watchdogService = Get-Service -Name "SAGRA-SystemWatchdog" -ErrorAction SilentlyContinue
    if ($watchdogService) {
        Write-DeployStep "Atualizar watchdog de disponibilidade"
        try {
            $watchdogCode = Join-Path $currentRoot "system_watchdog_service.py"
            $expectedHash = (Get-FileHash -LiteralPath $watchdogCode -Algorithm SHA256).Hash.ToLowerInvariant()
            $watchdogStartedAfter = (Get-Date).ToUniversalTime()
            if ($watchdogService.Status -eq "Running") {
                Restart-Service -Name $watchdogService.Name -Force -ErrorAction Stop
            } else {
                Start-Service -Name $watchdogService.Name -ErrorAction Stop
            }
            $watchdogService.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
            $watchdogStatusPath = Join-Path $layout.Shared "run\system_watchdog_status.json"
            $watchdogDeadline = (Get-Date).AddSeconds(60)
            $watchdogUpdated = $false
            do {
                if (Test-Path -LiteralPath $watchdogStatusPath -PathType Leaf) {
                    try {
                        $watchdogStatus = Get-Content -LiteralPath $watchdogStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
                        $checkedAt = [datetime]::Parse([string]$watchdogStatus.checked_at).ToUniversalTime()
                        if ($checkedAt -ge $watchdogStartedAfter.AddSeconds(-2) -and [string]$watchdogStatus.code_sha256 -eq $expectedHash) {
                            $watchdogUpdated = $true
                            break
                        }
                    } catch {}
                }
                Start-Sleep -Seconds 1
            } while ((Get-Date) -lt $watchdogDeadline)
            if ($watchdogUpdated) {
                Write-DeployOk "Watchdog atualizado e status validado"
            } else {
                Write-DeployWarn "Watchdog iniciou, mas nao confirmou o hash da nova release em 60s; confira status-watchdog-sistema.ps1"
            }
        } catch {
            Write-DeployWarn "Nao foi possivel atualizar o watchdog sem interromper o deploy: $_"
        }
    }

    # Sync e Monitor executam o codigo de current\; sem restart seguiriam com a
    # release anterior ate um reinicio acidental. Falhas aqui so geram aviso: o
    # SystemWatchdog recupera os servicos assim que o lock for removido.
    Write-DeployStep "Atualizar Sync andamentos e Monitor"
    $syncRestartedAfter = (Get-Date).ToUniversalTime()
    $syncRestarted = Restart-SagraBackgroundServiceForDeploy -Name "SAGRA-SyncAndamentos"
    $null = Restart-SagraBackgroundServiceForDeploy -Name "SAGRA-MonitorSyncAndamentos"
    if ($syncRestarted) {
        $syncHeartbeat = Join-Path $currentRoot "logs\sync\sync_heartbeat.json"
        if (Wait-SyncHeartbeatRenewed -HeartbeatPath $syncHeartbeat -StartedAfterUtc $syncRestartedAfter) {
            Write-DeployOk "Sync com processo novo e primeiro ciclo concluido"
        } else {
            Write-DeployWarn "Sync reiniciou, mas nao concluiu ciclo em 120s; confira $syncHeartbeat"
        }
    }
} finally {
    if ($maintenanceEntered) {
        Exit-SystemWatchdogMaintenance -ProdPath $ProdPath
    }
}

Write-DeployLog -ProdPath $ProdPath -Message "publicar-release-prod OK: $ReleaseName"
Write-DeployStep "Concluido"
Write-Host "Release publicada: $currentRoot" -ForegroundColor Green
Write-Host "Teste: home, login, /papelaria" -ForegroundColor Green
Write-Host "Sync andamentos e Monitor (NSSM): reiniciados dentro do lock de manutencao." -ForegroundColor DarkGray
