#Requires -Version 5.1
<#
.SYNOPSIS
  Gera pacote de produÃ§Ã£o em deploy/release/ â€” pasta Ãºnica para copiar ao servidor.

.USAGE
  pnpm package:release
  ou: powershell -File deploy/scripts/package-release.ps1
#>
param(
    [switch]$SkipBuild,
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ($OutDir) {
    $Release = (Resolve-Path -LiteralPath $OutDir -ErrorAction SilentlyContinue)
    if (-not $Release) { $Release = $OutDir }
} else {
    $Release = Join-Path $Root "deploy\release"
}

$ExcludeDirNames = @(
    "__pycache__", ".pytest_cache", "node_modules", ".git", ".vite",
    "recovery_temp", "logs", "legacy_or_unused"
)
$ExcludeFilePatterns = @("*.pyc", "*.pyo", "*.log", ".env", "Thumbs.db")

function Test-ExcludedPath {
    param([string]$FullPath, [string]$BasePath)
    $rel = $FullPath.Substring($BasePath.Length).TrimStart("\", "/")
  foreach ($part in $rel -split '[\\/]') {
        if ($ExcludeDirNames -contains $part) { return $true }
    }
    $leaf = Split-Path $FullPath -Leaf
    foreach ($pat in $ExcludeFilePatterns) {
        if ($leaf -like $pat) { return $true }
    }
    return $false
}

function Resolve-BuildPython {
    <#
    Resolve o interpretador Python real para o empacote.
    Evita o stub da Microsoft Store (WindowsApps\python.exe), comum em maquinas novas.
    #>
    $candidates = @()

    # 1) py launcher — escolhe install real (nao Store)
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        try {
            $exe = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -Last 1)
            if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path -LiteralPath $exe.Trim())) {
                $candidates += $exe.Trim()
            }
        } catch { }
    }

    # 2) python no PATH, descartando stub WindowsApps
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd -and $pythonCmd.Source -notmatch 'WindowsApps\\python\.exe$') {
        $candidates += $pythonCmd.Source
    }

    # 3) caminhos comuns de instalacao do usuario / Program Files
    $localPrograms = Join-Path $env:LOCALAPPDATA "Programs\Python"
    if (Test-Path -LiteralPath $localPrograms) {
        Get-ChildItem -LiteralPath $localPrograms -Directory -Filter "Python3*" -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $p = Join-Path $_.FullName "python.exe"
                if (Test-Path -LiteralPath $p) { $candidates += $p }
            }
    }
    foreach ($pf in @(
            "${env:ProgramFiles}\Python314\python.exe",
            "${env:ProgramFiles}\Python313\python.exe",
            "${env:ProgramFiles}\Python312\python.exe",
            "${env:ProgramFiles(x86)}\Python314\python.exe"
        )) {
        if ($pf -and (Test-Path -LiteralPath $pf)) { $candidates += $pf }
    }

    foreach ($cand in ($candidates | Select-Object -Unique)) {
        try {
            $ver = & $cand -c "import sys; print(sys.version_info.major)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver -match '^\d+$') {
                return $cand
            }
        } catch { }
    }

    throw @"
Python real nao encontrado (apenas stub da Microsoft Store ou ausente).
Instale Python 3.12+ de https://www.python.org/downloads/ com 'Add python.exe to PATH',
ou desative o alias em Configuracoes > Aplicativos > Aliases de execucao do aplicativo.
"@
}

function Copy-Tree {
    param(
        [string]$Source,
        [string]$Dest,
        [string[]]$ExtraExcludeDirs = @()
    )
    if (-not (Test-Path $Source)) {
        Write-Warning "Origem inexistente: $Source"
        return
    }
    $allExclude = $ExcludeDirNames + $ExtraExcludeDirs
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Get-ChildItem -Path $Source -Recurse -Force | ForEach-Object {
        $full = $_.FullName
        if (Test-ExcludedPath $full $Source) { return }
        foreach ($d in $ExtraExcludeDirs) {
            if ($full -match [regex]::Escape($d)) { return }
        }
        $rel = $full.Substring($Source.Length).TrimStart("\", "/")
        $target = Join-Path $Dest $rel
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
        } else {
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            Copy-Item -LiteralPath $full -Destination $target -Force
        }
    }
}

function Write-Step([string]$Msg) {
    Write-Host ""
    Write-Host "==> $Msg" -ForegroundColor Cyan
}

Write-Step "SAGRA Web - pacote de producao"
Write-Host "Origem:  $Root"
Write-Host "Destino: $Release"

if (Test-Path $Release) {
    Write-Step "Limpando $Release"
    Remove-Item -LiteralPath $Release -Recurse -Force
}
New-Item -ItemType Directory -Path $Release -Force | Out-Null

if (-not $SkipBuild) {
    Write-Step "Build SPA (Vite)"
    Push-Location (Join-Path $Root "apps\web")
    $env:NODE_ENV = "production"
    $env:VITE_BASE_PATH = "/sagra/"
    $env:VITE_API_PREFIX = "/sagra/api"
    Write-Host "Build SPA: base /sagra/; API em /sagra/api (OBS usa /api)"
    pnpm exec vite build
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        throw "Falha no build do frontend"
    }
    Pop-Location
} else {
    Write-Host "(build ignorado: -SkipBuild)" -ForegroundColor Yellow
}

Write-Step "Backend Python"
Copy-Tree (Join-Path $Root "app\backend") (Join-Path $Release "app\backend")

Write-Step "ServiÃ§os (sync, monitor)"
Copy-Tree (Join-Path $Root "app\services") (Join-Path $Release "app\services") @("logs")

Write-Step "Frontend React (dist)"
$spaDest = Join-Path $Release "app\frontend"
New-Item -ItemType Directory -Path $spaDest -Force | Out-Null
Copy-Item -Path (Join-Path $Root "apps\web\dist\*") -Destination $spaDest -Recurse -Force

Write-Step "Frontend legado (rollback em legacy/)"
$legacySrc = Join-Path $Root "app\frontend"
$legacyDest = Join-Path $Release "app\frontend\legacy"
if (Test-Path $legacySrc) {
    Copy-Tree $legacySrc $legacyDest
    # Template usado pela rota /api/reports/requisicao precisa ficar no frontend raiz.
    $requisicaoTemplate = Join-Path $Root "app\backend\templates\requisicao.html"
    if (-not (Test-Path $requisicaoTemplate)) {
        $requisicaoTemplate = Join-Path $legacySrc "requisicao.html"
    }
    if (Test-Path $requisicaoTemplate) {
        Copy-Item -LiteralPath $requisicaoTemplate -Destination (Join-Path $spaDest "requisicao.html") -Force
    }
    # Remover index SPA duplicado se existir no legado
    $legacyIndex = Join-Path $legacyDest "index.html"
    if (Test-Path $legacyIndex) {
        $txt = Get-Content $legacyIndex -Raw -ErrorAction SilentlyContinue
        if ($txt -match 'id="root"') {
            Remove-Item $legacyIndex -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-Step "Configuracao producao (10.1.1.73)"
$configDest = Join-Path $Release "config"
$prodConfigTpl = Join-Path $Root "deploy\templates\config"
New-Item -ItemType Directory -Path $configDest -Force | Out-Null
Copy-Item (Join-Path $prodConfigTpl "config.json") (Join-Path $configDest "config.json") -Force
Copy-Item (Join-Path $prodConfigTpl ".env.example") (Join-Path $configDest ".env.example") -Force
Copy-Item (Join-Path $prodConfigTpl "config.example.json") (Join-Path $configDest "config.example.json") -Force
if (Test-Path (Join-Path $Root "config\config_painel_global.json")) {
    Copy-Item (Join-Path $Root "config\config_painel_global.json") $configDest -Force
}

Write-Step "Nginx + SQL + scripts operacionais"
Copy-Tree (Join-Path $Root "deploy\nginx") (Join-Path $Release "nginx")
Copy-Tree (Join-Path $Root "deploy\sql") (Join-Path $Release "sql")
Copy-Tree (Join-Path $Root "deploy\bat") (Join-Path $Release "scripts\bat")
$opsScripts = Join-Path $Release "scripts\ops"
New-Item -ItemType Directory -Path $opsScripts -Force | Out-Null
@(
    "rebuild_os_filter_options.py",
    "rebuild_os_ultimo_andamento.py",
    "validate_os_ultimo_andamento.py"
) | ForEach-Object {
    $src = Join-Path $Root "scripts\$_"
    if (Test-Path $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $opsScripts $_) -Force
    }
}

Write-Step "DiretÃ³rios de dados (vazios)"
@(
    "storage",
    "storage_client_uploads",
    "storage_test",
    "storage\analise_indications",
    "local_services\dist"
) | ForEach-Object {
    $p = Join-Path $Release $_
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    ".gitkeep" | Set-Content (Join-Path $p ".gitkeep") -Encoding utf8
}

Write-Step "Arquivos raiz do pacote"
Copy-Item (Join-Path $Root "app\backend\requirements.txt") (Join-Path $Release "requirements.txt") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\requirements-ocr.txt") (Join-Path $Release "requirements-ocr.txt") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\LEIA-ME-DEPLOY.md") (Join-Path $Release "LEIA-ME.md") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\iniciar-api.bat") (Join-Path $Release "iniciar-api.bat") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\parar-api.bat") (Join-Path $Release "parar-api.bat") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\parar-api.ps1") (Join-Path $Release "parar-api.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\liberar-porta-api.ps1") (Join-Path $Release "liberar-porta-api.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\preparar-logs.ps1") (Join-Path $Release "preparar-logs.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\iniciar-api-detached.ps1") (Join-Path $Release "iniciar-api-detached.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\_iniciar-sync-andamentos.cmd") (Join-Path $Release "_iniciar-sync-andamentos.cmd") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\instalar-dependencias.bat") (Join-Path $Release "instalar-dependencias.bat") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\deploy-release-prod.ps1") (Join-Path $Release "deploy-release-prod.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\deploy-release-prod.bat") (Join-Path $Release "deploy-release-prod.bat") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\publicar-release.ps1") (Join-Path $Release "publicar-release.ps1") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\publicar-release.bat") (Join-Path $Release "publicar-release.bat") -Force

# Sync 24/7 — NSSM service + watchdog externo
$syncServiceScripts = @(
    "instalar-servico-sync.ps1",
    "parar-servico-sync.ps1",
    "desinstalar-servico-sync.ps1",
    "status-servico-sync.ps1",
    "watchdog-sync.ps1",
    "instalar-watchdog-sync.ps1",
    "instalar-servico-monitor-sync.ps1",
    "parar-servico-monitor-sync.ps1",
    "desinstalar-servico-monitor-sync.ps1",
    "status-servico-monitor-sync.ps1"
)
foreach ($name in $syncServiceScripts) {
    $src = Join-Path $PSScriptRoot "..\templates\$name"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src (Join-Path $Release $name) -Force
    } else {
        Write-Warning "Template ausente: $src"
    }
}

$syncService = Join-Path $Root "sync_andamentos_service.py"
if (Test-Path -LiteralPath $syncService) {
    Copy-Item -LiteralPath $syncService (Join-Path $Release "sync_andamentos_service.py") -Force
    Write-Host "sync_andamentos_service.py incluido na raiz do pacote"
} else {
    Write-Warning "sync_andamentos_service.py nao encontrado em $Root"
}

$syncOld = Join-Path $Root "sync_andamentos_v2_Old.py"
if (Test-Path -LiteralPath $syncOld) {
    Copy-Item -LiteralPath $syncOld (Join-Path $Release "sync_andamentos_v2_Old.py") -Force
    Write-Host "sync_andamentos_v2_Old.py incluido na raiz do pacote (obrigatorio para o service)"
} else {
    Write-Warning "sync_andamentos_v2_Old.py nao encontrado em $Root - sync usara fallback app/services/sync_andamentos_v2.py"
}

$monitorService = Join-Path $Root "monitor_sync_andamentos_service.py"
if (Test-Path -LiteralPath $monitorService) {
    Copy-Item -LiteralPath $monitorService (Join-Path $Release "monitor_sync_andamentos_service.py") -Force
    Write-Host "monitor_sync_andamentos_service.py incluido na raiz do pacote"
} else {
    Write-Warning "monitor_sync_andamentos_service.py nao encontrado em $Root"
}

Write-Step "Bibliotecas OCR embutidas (python_pkgs, sem pip no servidor)"
$vendorDir = Join-Path $Release "python_pkgs"
$wheelsDir = Join-Path $Release "wheels"
# Servidor de producao (cgrafsysvm) roda Python 3.10 — NAO usar a versao do DEV (ex.: 3.14).
$prodPyTag = if ($env:SAGRA_PROD_PYTHON_TAG) { $env:SAGRA_PROD_PYTHON_TAG.Trim() } else { "310" }
$prodPyVersion = if ($env:SAGRA_PROD_PYTHON_VERSION) { $env:SAGRA_PROD_PYTHON_VERSION.Trim() } else { "3.10" }
$prodAbi = "cp$prodPyTag"
if (Test-Path $vendorDir) {
    Remove-Item -LiteralPath $vendorDir -Recurse -Force
}
if (Test-Path $wheelsDir) {
    Remove-Item -LiteralPath $wheelsDir -Recurse -Force
}
New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
New-Item -ItemType Directory -Path $wheelsDir -Force | Out-Null
$py = Resolve-BuildPython
Write-Host "Python (build): $py"
Write-Host "Alvo producao:  Python $prodPyVersion ($prodAbi / win_amd64)"
& $py -m pip install --upgrade pip wheel -q
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao atualizar pip/wheel antes de embutir OCR"
}

# Baixa wheels do ABI de producao (cross-platform) e instala em python_pkgs /
# email-validator + deps leves (sem extensao nativa) tambem entram no pacote embutido.
$ocrPkgs = @(
    "pytesseract>=0.3.10",
    "Pillow>=10.0.0",
    "email-validator>=2.0.0,<3.0",
    "packaging",
    "idna",
    "dnspython"
)
& $py -m pip download `
    --python-version $prodPyTag `
    --only-binary=:all: `
    --platform win_amd64 `
    --implementation cp `
    --abi $prodAbi `
    -d $wheelsDir `
    @ocrPkgs
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao baixar wheels OCR para Python $prodPyVersion ($prodAbi). Pacote nao e seguro para o servidor."
}
$pillowWheel = Get-ChildItem -LiteralPath $wheelsDir -Filter "pillow-*-$prodAbi-*.whl" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $pillowWheel) {
    throw "Wheel Pillow $prodAbi nao encontrada em $wheelsDir (evita empacotar Pillow do Python do DEV)."
}
Write-Host "Pillow wheel: $($pillowWheel.Name)"

& $py -m pip install --target $vendorDir --no-compile --no-deps --no-index --find-links $wheelsDir `
    --platform win_amd64 --python-version $prodPyTag --implementation cp --abi $prodAbi `
    --only-binary=:all: `
    pillow pytesseract email-validator packaging idna dnspython
if ($LASTEXITCODE -ne 0) {
    throw "Falha ao embutir pytesseract/Pillow ($prodAbi) em python_pkgs."
}

$imagingNative = Get-ChildItem -LiteralPath (Join-Path $vendorDir "PIL") -Filter "_imaging*" -ErrorAction SilentlyContinue
if (-not $imagingNative) {
    throw "python_pkgs/PIL sem _imaging* apos install — pacote invalido para o servidor."
}
Write-Host "python_pkgs OK (alvo $prodAbi; nativo: $($imagingNative.Name -join ', '))"

$version = Get-Date -Format "yyyy-MM-dd HH:mm"
@"
SAGRA Web - pacote de producao
Gerado em: $version
Origem: $Root
Python build (DEV): $((& $py -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null))
Python alvo (python_pkgs/wheels): $prodPyVersion ($prodAbi win_amd64)
"@ | Set-Content (Join-Path $Release "VERSION.txt") -Encoding utf8

Write-Step "ConcluÃ­do"
$sizeMb = [math]::Round(
    ((Get-ChildItem $Release -Recurse -File | Measure-Object Length -Sum).Sum / 1MB),
    1
)
Write-Host "Pacote pronto: $Release ($sizeMb MB)" -ForegroundColor Green

$releaseStamp = Get-Date -Format "yyyyMMdd_HHmmss"
$deployedAt = Get-Date -Format "o"
@"
release=package_$releaseStamp
deployed_at=$deployedAt
source=dev_package
"@ | Set-Content (Join-Path $Release "RELEASE.txt") -Encoding utf8

$versionJson = @{
    release = "package_$releaseStamp"
    deployedAt = $deployedAt
    source = "dev_package"
} | ConvertTo-Json -Compress
$versionJson | Set-Content (Join-Path $Release "app\frontend\version.json") -Encoding utf8

Write-Host "Copie a pasta inteira para o servidor (ex.: C:\Sistemas\SagraWeb)" -ForegroundColor Green
