#Requires -Version 5.1
<#
.SYNOPSIS
  Build + deploy do SAGRA Web para o servidor de producao (\\cgrafsysvm\...).

.USAGE
  deploy-producao.bat
  deploy-producao.bat -SkipBuild
  deploy-producao.bat -TargetPath "C:\Sistemas CGraf\Sagra Web"
  powershell -File deploy/scripts/deploy-producao.ps1 -DryRun
#>
param(
    [switch]$SkipBuild,
    [switch]$DryRun,
    [switch]$ForceConfig,
    [switch]$RestartApi,
    [string]$TargetPath = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Release = Join-Path $Root "deploy\release"
$PackageScript = Join-Path $Root "deploy\scripts\package-release.ps1"

$PreserveDirs = @(
    "storage",
    "storage_client_uploads",
    "storage_test",
    "logs",
    "recovery_temp",
    # PNGs de prévia (upload manual) e demais artefatos Corel/planilha no servidor
    "Modelos",
    # Cache de prévia rápida TIF (gravação pendente/externa)
    "data",
    # Layout versionado no servidor — NUNCA apagar com /MIR
    # (NSSM AppDirectory aponta para current\; releases/shared/deploy sao persistentes)
    "current",
    "releases",
    "shared",
    "deploy",
    ".deploy_backup"
)

function Write-Step([string]$Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-Ok([string]$Msg) {
    Write-Host "    OK: $Msg" -ForegroundColor Green
}

function Write-Warn([string]$Msg) {
    Write-Host "    AVISO: $Msg" -ForegroundColor Yellow
}

function Write-Err([string]$Msg) {
    Write-Host "    ERRO: $Msg" -ForegroundColor Red
}

function Test-ServerReachable([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    try {
        $probe = Join-Path $Path ".deploy_probe"
        if ($DryRun) { return $true }
        New-Item -ItemType File -Path $probe -Force | Out-Null
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Invoke-RobocopyDeploy {
    param(
        [string]$Source,
        [string]$Dest
    )

    $xd = @("__pycache__", ".git", "node_modules", ".vite", ".pytest_cache") + $PreserveDirs

    $xf = @(".env", "vapid.json")
    if (-not $ForceConfig) {
        $xf += "config.json"
    }

    $robocopyArgs = @(
        $Source, $Dest,
        "/MIR", "/Z", "/FFT", "/R:3", "/W:5",
        "/NP", "/NDL", "/NJS", "/NJH",
        "/XD"
    ) + $xd + @(
        "/XF"
    ) + $xf

    Write-Host ("robocopy " + ($robocopyArgs -join " ")) -ForegroundColor DarkGray
    if ($DryRun) {
        Write-Warn "DryRun: robocopy nao executado."
        return 0
    }

    & robocopy @robocopyArgs | Out-Host
    $code = $LASTEXITCODE
    # Robocopy: 0-7 = sucesso; >= 8 = erro
    if ($code -ge 8) {
        throw "Robocopy falhou com codigo $code"
    }
    return $code
}

function Restore-PreservedConfig {
    param(
        [string]$Dest,
        [string]$BackupDir
    )
    if (-not (Test-Path $BackupDir)) { return }

    $envBackup = Join-Path $BackupDir ".env"
    if (Test-Path $envBackup) {
        $destEnv = Join-Path $Dest "config\.env"
        Copy-Item -LiteralPath $envBackup -Destination $destEnv -Force
        Write-Ok "config\.env restaurado (senhas do servidor preservadas)"
    }

    if (-not $ForceConfig) {
        $cfgBackup = Join-Path $BackupDir "config.json"
        if (Test-Path $cfgBackup) {
            Copy-Item -LiteralPath $cfgBackup -Destination (Join-Path $Dest "config\config.json") -Force
            Write-Ok "config\config.json restaurado"
        }
    }
}

function Repair-SagraLogsAcl {
    param([string]$Dest)

    $prep = Join-Path $Dest "preparar-logs.ps1"
    if (-not (Test-Path -LiteralPath $prep)) {
        Write-Warn "preparar-logs.ps1 ausente; ACL de logs nao ajustada."
        return
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $prep -Root $Dest -Quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Permissoes de logs\ revisadas (Usuarios podem gravar sagra_api.log)"
    } else {
        Write-Warn "preparar-logs.ps1 retornou codigo $LASTEXITCODE (verifique ACL manualmente)"
    }
}

function Test-DeployIntegrity {
    param([string]$Dest)

    $checks = @(
        @{ Path = "app\frontend\index.html"; Label = "SPA index.html" },
        @{ Path = "app\frontend\manifest.webmanifest"; Label = "PWA manifest" },
        @{ Path = "app\frontend\manifest-painel-os.webmanifest"; Label = "PWA Painel OS manifest" },
        @{ Path = "app\frontend\sw.js"; Label = "PWA service worker" },
        @{ Path = "app\frontend\icons\icon-192.png"; Label = "PWA icon 192" },
        @{ Path = "app\frontend\icons\painel-os-192.png"; Label = "PWA Painel OS icon 192" },
        @{ Path = "app\frontend\assets"; Label = "SPA assets/" },
        @{ Path = "app\backend\routers\api.py"; Label = "api.py" },
        @{ Path = "iniciar-api.bat"; Label = "iniciar-api.bat" }
    )

    $failed = $false
    foreach ($c in $checks) {
        $full = Join-Path $Dest $c.Path
        if (-not (Test-Path -LiteralPath $full)) {
            Write-Err "Ausente no servidor: $($c.Label) ($($c.Path))"
            $failed = $true
        } else {
            Write-Ok $c.Label
        }
    }

    $apiPath = Join-Path $Dest "app\backend\routers\api.py"
    if (Test-Path -LiteralPath $apiPath) {
        $apiText = Get-Content -LiteralPath $apiPath -Raw -Encoding UTF8
        if ($apiText -match "_register_spa_shell_routes") {
            Write-Ok "Rotas SPA shell (login/activate) presentes em api.py"
        } else {
            Write-Err "api.py SEM _register_spa_shell_routes - deploy incompleto!"
            $failed = $true
        }
    }

    $assetsDir = Join-Path $Dest "app\frontend\assets"
    if (Test-Path -LiteralPath $assetsDir) {
        $jsCount = (Get-ChildItem -LiteralPath $assetsDir -Filter "index-*.js" -ErrorAction SilentlyContinue).Count
        if ($jsCount -lt 1) {
            Write-Err "Nenhum index-*.js em assets/ - build SPA invalido"
            $failed = $true
        }
    }

    if ($failed) {
        throw "Verificacao pos-deploy falhou. Revise os itens acima."
    }
}

function Invoke-RestartApi {
    param([string]$Dest)

    $bat = Join-Path $Dest "iniciar-api.bat"
    if (-not (Test-Path -LiteralPath $bat)) {
        Write-Warn "iniciar-api.bat nao encontrado; reinicie manualmente."
        return
    }

    # So reinicia se o destino for caminho local (nao UNC remota sem sessao interativa)
    $isUnc = $Dest -match "^\\\\"
    if ($isUnc) {
        Write-Warn "Destino UNC: nao e possivel reiniciar a API daqui."
        Write-Host "    No servidor 10.1.1.73, execute: $Dest\iniciar-api.bat" -ForegroundColor Yellow
        return
    }

    Write-Step "Reiniciando API (iniciar-api.bat)"
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$bat`"" -WorkingDirectory $Dest -PassThru -WindowStyle Normal
    Write-Ok "iniciar-api.bat iniciado (PID $($proc.Id)). Confira a janela do console."
}

# --- main ---

Write-Step "SAGRA Web - deploy producao"
Write-Host "Origem (repo):  $Root"
Write-Host "Pacote:         $Release"
Write-Host "Destino:        $TargetPath"
if ($DryRun) { Write-Host "Modo:           DRY RUN (sem alteracoes)" -ForegroundColor Yellow }

if (-not $SkipBuild) {
    Write-Step "Gerando pacote (pnpm package:release)"
    if ($DryRun) {
        Write-Warn "DryRun: build ignorado."
    } else {
        Push-Location $Root
        try {
            & pnpm package:release
            if ($LASTEXITCODE -ne 0) { throw "pnpm package:release falhou (codigo $LASTEXITCODE)" }
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Warn "Build ignorado (-SkipBuild). Usando deploy\release existente."
    if (-not (Test-Path $Release)) {
        throw "deploy\release inexistente. Rode sem -SkipBuild primeiro."
    }
}

Write-Step "Verificando acesso ao servidor"
if (-not (Test-ServerReachable $TargetPath)) {
    $msg = @(
        "Nao foi possivel gravar em: $TargetPath",
        "",
        "Verifique:",
        "  VPN/rede camara conectada",
        "  Permissao de escrita na pasta compartilhada",
        "  Caminho correto (ex.: \\cgrafsysvm\Sistemas CGraf\Sagra Web)"
    ) -join [Environment]::NewLine
    throw $msg
}
Write-Ok "Servidor acessivel"

# Copia /MIR na raiz e incompativel com o layout versionado: em 15/10/2026 derrubou a API
# de current\, esvaziou uma release e apagou config\vapid.json do servidor.
$targetCurrent = Join-Path $TargetPath "current"
if ((Test-Path -LiteralPath $targetCurrent) -or (Test-Path -LiteralPath (Join-Path $TargetPath "releases"))) {
    throw (@(
        "Destino usa o layout versionado (current\ + releases\ + shared\): deploy-producao.ps1 (robocopy /MIR na raiz) foi bloqueado.",
        "",
        "Use na estacao DEV:",
        "  pnpm package:release",
        "  powershell -File deploy\scripts\publicar-ultimo-release-remoto.ps1"
    ) -join [Environment]::NewLine)
}

$backupDir = Join-Path $TargetPath ".deploy_backup"
if (-not $DryRun -and (Test-Path -LiteralPath $TargetPath)) {
    Write-Step "Backup config do servidor"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $serverEnv = Join-Path $TargetPath "config\.env"
    $serverCfg = Join-Path $TargetPath "config\config.json"
    if (Test-Path $serverEnv) {
        Copy-Item -LiteralPath $serverEnv -Destination (Join-Path $backupDir ".env") -Force
        Write-Ok ".env salvo em .deploy_backup\"
    }
    if (Test-Path $serverCfg) {
        Copy-Item -LiteralPath $serverCfg -Destination (Join-Path $backupDir "config.json") -Force
        Write-Ok "config.json salvo em .deploy_backup\"
    }
}

Write-Step "Copiando pacote para o servidor (robocopy /MIR)"
Write-Host 'Preservados: config\.env, storage/, logs/, Modelos/ (previews PNG) e config.json do servidor' -ForegroundColor DarkGray
$rc = Invoke-RobocopyDeploy -Source $Release -Dest $TargetPath
Write-Ok "Robocopy concluido (codigo $rc)"

if (-not $DryRun) {
    Write-Step "Restaurando config sensivel do servidor"
    Restore-PreservedConfig -Dest $TargetPath -BackupDir $backupDir

    Write-Step "Verificacao pos-deploy"
    Test-DeployIntegrity -Dest $TargetPath

    Write-Step "Permissoes de logs (operadores / iniciar-api.bat)"
    Repair-SagraLogsAcl -Dest $TargetPath
}

Write-Step "Concluido"
Write-Host ""
Write-Host "Proximo passo OBRIGATORIO no servidor 10.1.1.73:" -ForegroundColor Yellow
Write-Host "  1. Abra CMD na pasta: $TargetPath"
Write-Host "  2. Execute: iniciar-api.bat"
Write-Host '  3. Confirme no log:'
Write-Host '       SPA shell: rotas /login e /login/activate registradas'
Write-Host '       Uvicorn running on http://127.0.0.1:8050'
Write-Host '  4. Teste: http://127.0.0.1:8050/health'
Write-Host '          http://10.1.1.73/  (links /sagra/ redirecionam para /)'
Write-Host ""

if ($RestartApi -and -not $DryRun) {
    Invoke-RestartApi -Dest $TargetPath
}
