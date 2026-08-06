#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy por release versionada - copia para releases/{nome} sem sobrescrever producao legada.

.USAGE
  # Na estacao DEV - nova release:
  powershell -File deploy/scripts/deploy_release.ps1 -ReleaseName "20260611_180000"

  # NO SERVIDOR - ativar release existente (nao exige C:\dev\SagraWeb):
  powershell -File deploy\scripts\activate-release.ps1 -ReleaseName "staging_20260611_193049" -ConfirmProductionSwitch

  # Ou via deploy_release (modo ativar):
  powershell -File deploy\scripts\deploy_release.ps1 -ReleaseName "staging_..." -ActivateOnly -ConfirmProductionSwitch
#>
param(
    [string]$DevPath = "C:\dev\SagraWeb",
    [string]$ProdPath = "",
    [string]$ReleaseName = "",
    [string]$NginxConfPath = "",
    [switch]$SkipBuild,
    [switch]$FromProduction,
    [switch]$Activate,
    [switch]$ActivateOnly,
    [switch]$ConfirmProductionSwitch,
    [switch]$RestartApi,
    [switch]$ReloadNginx,
    [switch]$Cleanup,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. "$PSScriptRoot\deploy-common.ps1"

if ($ActivateOnly) { $Activate = $true }

if ($Activate -or $RestartApi -or $ReloadNginx) {
    if (-not $ConfirmProductionSwitch) {
        throw @(
            "Operacao bloqueada: -Activate/-ActivateOnly, -RestartApi ou -ReloadNginx exigem -ConfirmProductionSwitch."
        ) -join " "
    }
}

if (-not $ReleaseName) {
    $ReleaseName = Get-DeployTimestamp
}

$ProdPath = Resolve-DeployProdPath -ProdPath $ProdPath
$NginxConfPath = Resolve-DeployNginxConf -NginxConfPath $NginxConfPath
$layout = Get-ReleaseLayoutPaths $ProdPath
$targetRelease = Join-Path $layout.Releases $ReleaseName
$releaseExists = Test-Path -LiteralPath $targetRelease
$activateExisting = $Activate -and $releaseExists -and ($ActivateOnly -or $SkipBuild)

Write-DeployStep "Deploy release - SAGRA Web"
Write-Host "Release:     $ReleaseName"
Write-Host "Producao:    $ProdPath"
Write-Host "Destino:     $targetRelease"
if ($activateExisting) {
    Write-Host "Modo:        ATIVAR release existente (sem DEV)" -ForegroundColor Yellow
}
if ($WhatIf) { Write-Host "Modo:        WHAT IF" -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath $ProdPath)) {
    throw "Producao inacessivel: $ProdPath"
}
if (-not (Test-DeployPathWritable $ProdPath)) {
    throw "Sem permissao de escrita em producao"
}

if ($activateExisting) {
    if (-not $WhatIf) {
        Write-DeployStep "Validar e reconectar shared"
        $junctionsOk = Connect-ReleaseToShared -ReleasePath $targetRelease -SharedRoot $layout.Shared -ProdLocalPath $ProdPath
        Test-ReleaseIntegrity -ReleasePath $targetRelease -RequireSharedLinks:$junctionsOk
        if (-not $junctionsOk) {
            Write-DeployWarn "Junctions pendentes - execute finish-release-junctions.ps1"
        }

        Write-DeployStep "Ativar release (current)"
        Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $ReleaseName -ConfirmProductionSwitch
        Write-DeployLog -ProdPath $ProdPath -Message "Release $ReleaseName ativada (ActivateOnly)"

        $health = Invoke-ReleaseHealthCheck
        if ($health.Ok) {
            Write-DeployLog -ProdPath $ProdPath -Message "Health OK: $($health.Body)"
        } else {
            Write-DeployWarn "Health indisponivel (inicie a API): $($health.Body)"
            Write-Host "  cd current && iniciar-api.bat" -ForegroundColor Yellow
        }
    }

    Write-DeployStep "Concluido"
    Write-Host "Release ativa: $(Join-Path $ProdPath 'current')" -ForegroundColor Green
    exit 0
}

# --- Modo deploy completo (requer DEV ou FromProduction) ---
$Root = $null
if (Test-Path -LiteralPath $DevPath) {
    $Root = Normalize-DeployPath $DevPath
} elseif (-not $FromProduction) {
    throw "DEV inacessivel: $DevPath. Use -FromProduction, -ActivateOnly ou activate-release.ps1 no servidor."
}

Write-Host "DEV:         $(if ($Root) { $Root } else { '(nao usado)' })"

if (Test-Path -LiteralPath $NginxConfPath) {
    $ngx = Test-NginxConfigReadable -NginxConfPath $NginxConfPath
    if ($ngx.Ok) {
        Write-DeployOk "NGINX: $($ngx.Message) (porta $($ngx.Port))"
    }
} else {
    Write-DeployWarn "nginx.conf nao encontrado"
}

Initialize-ReleaseLayout -ProdPath $ProdPath | Out-Null
Initialize-SharedLayout -ProdPath $ProdPath -SeedFromLegacyRoot | Out-Null
if ($Root) {
    Copy-DeployScriptsToProd -ProdPath $ProdPath -DevRoot $Root
} else {
    Copy-DeployScriptsToProd -ProdPath $ProdPath
}

if ($releaseExists) {
    throw "Release ja existe: $targetRelease (use -ActivateOnly para ativar)"
}

$ReleasePackage = if ($Root) { Join-Path $Root "deploy\release" } else { "" }

$backupName = "backup_pre_release_{0}" -f (Get-DeployTimestamp)
$backupDir = Join-Path $layout.DeployBackups $backupName
if (-not $WhatIf) {
    Write-DeployStep "Backup configs criticas"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    foreach ($rel in @("config\.env", "config\config.json", "VERSION.txt", "deploy\current-release.txt")) {
        $src = Join-Path $ProdPath $rel
        if (Test-Path -LiteralPath $src) {
            $destParent = Join-Path $backupDir (Split-Path $rel -Parent)
            if ($destParent -and -not (Test-Path $destParent)) {
                New-Item -ItemType Directory -Path $destParent -Force | Out-Null
            }
            Copy-Item -LiteralPath $src -Destination (Join-Path $backupDir $rel) -Force
            Write-DeployOk "Backup: $rel"
        }
    }
}

if ($FromProduction) {
    Write-DeployStep ("Snapshot da producao legada para releases\" + $ReleaseName)
    if (-not $WhatIf) {
        New-Item -ItemType Directory -Path $targetRelease -Force | Out-Null
        Invoke-SafeRobocopy -Source $ProdPath -Dest $targetRelease -Mirror
        foreach ($sub in @("releases", "current", "shared", "deploy")) {
            $accidental = Join-Path $targetRelease $sub
            if (Test-Path -LiteralPath $accidental) {
                Remove-Item -LiteralPath $accidental -Recurse -Force
            }
        }
        Set-ReleaseMetadata -ReleasePath $targetRelease -ReleaseName $ReleaseName -SourceDescription "snapshot_producao_legada"
    }
} else {
    Write-DeployStep "Gerar pacote a partir do DEV"
    if (-not $WhatIf) {
        if (-not $SkipBuild) {
            Push-Location $Root
            try {
                & pnpm package:release
                if ($LASTEXITCODE -ne 0) { throw "pnpm package:release falhou" }
            } finally {
                Pop-Location
            }
        } elseif (-not (Test-Path -LiteralPath $ReleasePackage)) {
            throw "deploy\release inexistente - rode sem -SkipBuild"
        }

        Write-DeployStep ("Copiar pacote para releases\" + $ReleaseName)
        New-Item -ItemType Directory -Path $targetRelease -Force | Out-Null
        Invoke-SafeRobocopy -Source $ReleasePackage -Dest $targetRelease -Mirror
        Set-ReleaseMetadata -ReleasePath $targetRelease -ReleaseName $ReleaseName -SourceDescription "dev_package"
    }
}

if ($WhatIf) {
    Write-DeployStep "WhatIf concluido"
    exit 0
}

if ($Root) {
    $devModelos = Join-Path $Root "Modelos"
    $sharedModelos = Join-Path $layout.Shared "Modelos"
    if (Test-Path -LiteralPath $devModelos) {
        Write-DeployStep "Sincronizar Modelos DEV -> shared (previews Papelaria, etc.)"
        Merge-MutableDirIntoShared -Source $devModelos -Dest $sharedModelos | Out-Null
    }
}

Write-DeployStep "Conectar release a shared/ (junctions)"
$junctionsOk = Connect-ReleaseToShared -ReleasePath $targetRelease -SharedRoot $layout.Shared -ProdLocalPath $ProdPath

Write-DeployStep "Validar release"
Test-ReleaseIntegrity -ReleasePath $targetRelease -RequireSharedLinks:$junctionsOk

$prepLogs = Join-Path $targetRelease "preparar-logs.ps1"
if (Test-Path -LiteralPath $prepLogs) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $prepLogs -Root $targetRelease -Quiet
}

Write-DeployLog -ProdPath $ProdPath -Message "Release $ReleaseName criada em releases\$ReleaseName"

if ($Activate) {
    Write-DeployStep "Ativar release (current)"
    Update-CurrentPointer -ProdPath $ProdPath -ReleaseName $ReleaseName -ConfirmProductionSwitch

    $health = Invoke-ReleaseHealthCheck
    if ($health.Ok) {
        Write-DeployLog -ProdPath $ProdPath -Message "Health OK: $($health.Body)"
    } else {
        Write-DeployWarn "Health indisponivel - inicie: current\iniciar-api.bat"
    }
} else {
    Write-DeployWarn "Release criada mas NAO ativada."
}

Remove-OldReleases -ProdPath $ProdPath -Cleanup:$Cleanup -ActiveRelease (Get-ActiveReleaseName $ProdPath) -PreviousRelease (Get-Content $layout.PreviousReleaseFile -ErrorAction SilentlyContinue)

Write-DeployStep "Concluido"
Write-Host "Release pronta: $targetRelease" -ForegroundColor Green
