# Publica o SAGRA Letreiro (self-contained, win-x64) e gera o instalador por usuário.
# Uso: powershell -ExecutionPolicy Bypass -File installer\build.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\SagraLetreiro\SagraLetreiro.csproj'
$publishDir = Join-Path $root 'artifacts\publish'
$iss = Join-Path $PSScriptRoot 'SagraLetreiro.iss'

$version = ([xml](Get-Content $project)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (-not $version) { $version = '2.0.0' }

$iscc = @(
    (Get-Command iscc -ErrorAction SilentlyContinue).Source,
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 não encontrado (https://jrsoftware.org/isdl.php).' }

$webCss = Join-Path (Split-Path $root -Parent) 'apps\web\src\features\dashboard-setor-modern'
$cssDest = Join-Path $root 'src\SagraLetreiro.Core\Assets\toast'
if (Test-Path $webCss) {
    New-Item -ItemType Directory -Force -Path $cssDest | Out-Null
    foreach ($name in @(
        'dashboard-setor-modern.css',
        'dashboard-setor-modern-catalog.css',
        'dashboard-setor-modern-cards.css'
    )) {
        $from = Join-Path $webCss $name
        if (Test-Path $from) { Copy-Item $from (Join-Path $cssDest $name) -Force }
    }
}

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=none -p:DebugSymbols=false -o $publishDir
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish falhou.' }

$adminWeb = Join-Path $root 'admin-web'
$adminDist = Join-Path $adminWeb 'dist'
Push-Location $adminWeb
try {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpm) {
        pnpm install
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install do admin-web falhou.' }
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'pnpm build do admin-web falhou.' }
    }
    else {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install do admin-web falhou.' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build do admin-web falhou.' }
    }
}
finally {
    Pop-Location
}
if (-not (Test-Path (Join-Path $adminDist 'index.html'))) {
    throw "Build do admin-web não gerou $adminDist\index.html"
}
$adminDest = Join-Path $publishDir 'admin-web'
if (Test-Path $adminDest) { Remove-Item $adminDest -Recurse -Force }
Copy-Item $adminDist $adminDest -Recurse

& $iscc "/DAppVersion=$version" "/DPublishDir=$publishDir" $iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup falhou.' }

Write-Host "Instalador: $(Join-Path $root "artifacts\SAGRA-Letreiro-Setup-$version.exe")"
