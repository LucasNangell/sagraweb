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
$AllowedOutputRoot = [System.IO.Path]::GetFullPath((Join-Path $Root "deploy")).TrimEnd('\')
if ($OutDir) {
    $Release = [System.IO.Path]::GetFullPath($OutDir)
} else {
    $Release = [System.IO.Path]::GetFullPath((Join-Path $Root "deploy\release"))
}
$allowedPrefix = $AllowedOutputRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $Release.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutDir recusado: o pacote deve ficar dentro de $AllowedOutputRoot"
}
$guardPath = $Release
while ($guardPath -and $guardPath.StartsWith($AllowedOutputRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $guardPath) {
        $guardItem = Get-Item -LiteralPath $guardPath -Force
        if ($guardItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "OutDir recusado: destino ou ancestral e junction/symlink ($guardPath)"
        }
    }
    if ($guardPath.Equals($AllowedOutputRoot, [System.StringComparison]::OrdinalIgnoreCase)) { break }
    $parent = Split-Path $guardPath -Parent
    if (-not $parent -or $parent -eq $guardPath) { throw "OutDir recusado: ancestral invalido" }
    $guardPath = [System.IO.Path]::GetFullPath($parent)
}

$ExcludeDirNames = @(
    "__pycache__", ".pytest_cache", "node_modules", ".git", ".vite",
    "recovery_temp", "logs", "legacy_or_unused",
    # Mutáveis / runtime — ficam em shared\, não no pacote. Copiá-los faz o
    # robocopy falhar (codigo 8/9) quando o arquivo está aberto no DEV.
    "cache", "storage", "storage_client_uploads", "storage_test",
    "data", "generated", "email_images", "temp", "Modelos"
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

    # 1) py launcher -- escolhe install real (nao Store)
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

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return (-join ($bytes | ForEach-Object { $_.ToString("x2") }))
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
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
    $webRoot = Join-Path $Root "apps\web"
    $viteCmd = Join-Path $webRoot "node_modules\.bin\vite.cmd"
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw "Node.js nao encontrado no PATH; instale a versao declarada pelo projeto antes de gerar o pacote"
    }
    $hasViteCmd = Test-Path -LiteralPath $viteCmd -PathType Leaf
    $viteResolver = Join-Path $PSScriptRoot "resolve-vite-cli.ps1"
    $resolvedViteCli = $null
    if (Test-Path -LiteralPath $viteResolver -PathType Leaf) {
        $resolverOutput = & $viteResolver -WebRoot $webRoot 2>$null
        if ($LASTEXITCODE -eq 0 -and $resolverOutput) {
            $resolvedViteCli = [string]($resolverOutput | Where-Object { $_ } | Select-Object -Last 1)
            if (-not $resolvedViteCli) { $resolvedViteCli = $null }
        }
    }
    if (-not $resolvedViteCli -and -not $hasViteCmd) {
        throw "Vite local nao encontrado. Verificados: $viteCmd e $viteResolver. Instale as dependencias com pnpm 9.15.0 antes de gerar o pacote"
    }

    $previousNodeEnv = $env:NODE_ENV
    $previousBasePath = $env:VITE_BASE_PATH
    $previousApiPrefix = $env:VITE_API_PREFIX
    $buildExitCode = 1
    Push-Location $webRoot
    try {
        $env:NODE_ENV = "production"
        $env:VITE_BASE_PATH = "/sagra/"
        $env:VITE_API_PREFIX = "/sagra/api"
        Write-Host "Build SPA: base /sagra/; API em /sagra/api (OBS usa /api)"
        # Nao use `pnpm exec`, pois ele pode disparar uma instalacao implicita
        # durante o release. O alvo fisico do pnpm evita falha de junction no
        # vite.cmd; o shim fica como fallback para outros layouts locais.
        if ($resolvedViteCli) {
            & $nodeCommand.Source $resolvedViteCli build
        } else {
            & $viteCmd build
        }
        $buildExitCode = $LASTEXITCODE
    } finally {
        $env:NODE_ENV = $previousNodeEnv
        $env:VITE_BASE_PATH = $previousBasePath
        $env:VITE_API_PREFIX = $previousApiPrefix
        Pop-Location
    }
    if ($buildExitCode -ne 0) {
        throw "Falha no build do frontend (Vite retornou codigo $buildExitCode)"
    }
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
Copy-Item (Join-Path $PSScriptRoot "..\templates\requirements-tiff.txt") (Join-Path $Release "requirements-tiff.txt") -Force
Copy-Item (Join-Path $PSScriptRoot "check_tiff_runtime.py") (Join-Path $Release "check_tiff_runtime.py") -Force
Copy-Item (Join-Path $PSScriptRoot "check_release_runtime.py") (Join-Path $Release "check_release_runtime.py") -Force
Copy-Item (Join-Path $PSScriptRoot "..\templates\LEIA-ME-DEPLOY.md") (Join-Path $Release "LEIA-ME.md") -Force

# Copia TODOS os templates operacionais (.ps1/.bat/.cmd) para a raiz do pacote.
# Listas abaixo sao apenas "obrigatorios": ausencia = throw.
$templatesDir = Join-Path $PSScriptRoot "..\templates"
$templateFiles = @(Get-ChildItem -LiteralPath $templatesDir -File -ErrorAction Stop |
    Where-Object { $_.Extension -in @(".ps1", ".bat", ".cmd") })
if ($templateFiles.Count -lt 1) {
    throw "Nenhum template .ps1/.bat/.cmd em $templatesDir"
}
foreach ($tf in $templateFiles) {
    Copy-Item -LiteralPath $tf.FullName -Destination (Join-Path $Release $tf.Name) -Force
}
Write-Host ("Templates operacionais: {0} arquivo(s)" -f $templateFiles.Count)

$requiredTemplates = @(
    "iniciar-api.bat",
    "iniciar-api-detached.ps1",
    "parar-api.bat",
    "parar-api.ps1",
    "preparar-logs.ps1",
    "publicar-release.bat",
    "publicar-release.ps1",
    "deploy-release-prod.bat",
    "deploy-release-prod.ps1",
    "instalar-servico-sync.ps1",
    "instalar-servico-monitor-sync.ps1",
    "instalar-servico-api.ps1",
    "desinstalar-servico-api.ps1",
    "conceder-controle-servico.ps1",
    "instalar-servico-organizador-email.ps1",
    "desinstalar-servico-organizador-email.ps1",
    "status-watchdog-sistema.ps1",
    "suspender-watchdog-sistema.ps1",
    "retomar-watchdog-sistema.ps1",
    "desinstalar-servico-watchdog-sistema.ps1"
)
foreach ($name in $requiredTemplates) {
    if (-not (Test-Path -LiteralPath (Join-Path $Release $name) -PathType Leaf)) {
        throw "Template obrigatorio ausente no pacote: $name"
    }
}

# Servicos / workers da raiz do repositorio (AppDirectory = current\).
$rootRuntimePy = @(
    "system_watchdog_service.py",
    "sync_andamentos_service.py",
    "sync_andamentos_v2_Old.py",
    "sync_policy.py",
    "sync_os_deletes.py",
    "monitor_sync_andamentos_service.py",
    "organizador_email_sepim_service.py"
)
foreach ($name in $rootRuntimePy) {
    $src = Join-Path $Root $name
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
        throw "Arquivo runtime obrigatorio ausente na raiz do repo: $name"
    }
    Copy-Item -LiteralPath $src -Destination (Join-Path $Release $name) -Force
    Write-Host "$name incluido na raiz do pacote"
}

$systemWatchdogRunbook = Join-Path $Root "docs\RUNBOOK_WATCHDOG_SISTEMA.md"
if (Test-Path -LiteralPath $systemWatchdogRunbook) {
    Copy-Item -LiteralPath $systemWatchdogRunbook (Join-Path $Release "RUNBOOK_WATCHDOG_SISTEMA.md") -Force
} else {
    throw "Runbook obrigatorio do watchdog ausente: $systemWatchdogRunbook"
}

# Garante que todo script .py citado pelos instaladores NSSM exista no pacote.
Write-Step "Validar AppParameters dos instaladores NSSM"
$installerScripts = @(Get-ChildItem -LiteralPath $Release -Filter "instalar-servico-*.ps1" -File)
$referencedPy = New-Object System.Collections.Generic.HashSet[string]
foreach ($inst in $installerScripts) {
    foreach ($line in (Get-Content -LiteralPath $inst.FullName -Encoding UTF8)) {
        # $scriptName = "sync_andamentos_service.py"
        if ($line -match '(?i)\$scriptName\s*=\s*[''"]([A-Za-z0-9_\-]+\.py)[''"]') {
            [void]$referencedPy.Add($Matches[1])
        }
        # AppParameters ... something.py (literal)
        if ($line -match '(?i)AppParameters' -and $line -match '(?i)([A-Za-z0-9_\-]+\.py)') {
            [void]$referencedPy.Add($Matches[1])
        }
    }
}
$missingAppParams = @()
foreach ($pyName in ($referencedPy | Sort-Object)) {
    if (-not (Test-Path -LiteralPath (Join-Path $Release $pyName) -PathType Leaf)) {
        $missingAppParams += $pyName
    }
}
if ($missingAppParams.Count -gt 0) {
    throw ("Pacote incompleto -- scripts NSSM ausentes no release:`n  - " + ($missingAppParams -join "`n  - "))
}
Write-Host ("AppParameters/scripts NSSM OK ({0})" -f $referencedPy.Count)

Write-Step "Bibliotecas OCR embutidas (python_pkgs, sem pip no servidor)"
$vendorDir = Join-Path $Release "python_pkgs"
$wheelsDir = Join-Path $Release "wheels"
# Servidor de producao (cgrafsysvm) roda Python 3.10 -- NAO usar a versao do DEV (ex.: 3.14).
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
    throw "python_pkgs/PIL sem _imaging* apos install -- pacote invalido para o servidor."
}
Write-Host "python_pkgs OK (alvo $prodAbi; nativo: $($imagingNative.Name -join ', '))"

Write-Step "Bibliotecas TIFF embutidas (sem alterar NumPy da API)"
$tiffRequirements = Join-Path $Release "requirements-tiff.txt"
& $py -m pip download --python-version $prodPyTag --only-binary=:all: `
    --platform win_amd64 --implementation cp --abi $prodAbi --no-deps `
    -d $wheelsDir -r $tiffRequirements
if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar wheels TIFF para $prodAbi. Release abortada." }
& $py -m pip install --target $vendorDir --no-compile --no-deps --no-index --find-links $wheelsDir `
    --platform win_amd64 --python-version $prodPyTag --implementation cp --abi $prodAbi `
    --only-binary=:all: -r $tiffRequirements
if ($LASTEXITCODE -ne 0) { throw "Falha ao embutir tifffile/imagecodecs. Release abortada." }
@{ python_tag = $prodPyTag; python_version = $prodPyVersion } | ConvertTo-Json |
    Set-Content (Join-Path $Release "tiff-runtime.json") -Encoding UTF8
& $py (Join-Path $Release "check_tiff_runtime.py") --release-root $Release --package-only
if ($LASTEXITCODE -ne 0) { throw "Pacote TIFF incompleto ou ABI incorreto. Release abortada." }

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

Write-Step "Manifesto de integridade (SHA-256)"
$criticalFiles = @(
    "system_watchdog_service.py",
    "sync_andamentos_service.py",
    "monitor_sync_andamentos_service.py",
    "organizador_email_sepim_service.py",
    "check_release_runtime.py",
    "check_tiff_runtime.py",
    "instalar-servico-api.ps1",
    "status-watchdog-sistema.ps1",
    "suspender-watchdog-sistema.ps1",
    "retomar-watchdog-sistema.ps1",
    "iniciar-api-detached.ps1",
    "iniciar-api.bat",
    "app/backend/routers/api.py",
    "app/frontend/index.html"
)
$integrityFiles = [ordered]@{}
foreach ($relative in $criticalFiles) {
    $criticalPath = Join-Path $Release $relative
    if (-not (Test-Path -LiteralPath $criticalPath -PathType Leaf)) {
        throw "Arquivo critico ausente ao gerar manifesto: $relative"
    }
    $integrityFiles[$relative.Replace('\', '/')] = Get-Sha256Hex $criticalPath
}
[ordered]@{
    algorithm = "SHA256"
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    files = $integrityFiles
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Release "RELEASE-INTEGRITY.json") -Encoding UTF8

Write-Host "Copie a pasta inteira para o servidor (ex.: C:\Sistemas\SagraWeb)" -ForegroundColor Green
