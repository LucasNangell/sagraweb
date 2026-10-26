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

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }

dotnet publish $project -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=none -p:DebugSymbols=false -o $publishDir
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish falhou.' }

& $iscc "/DAppVersion=$version" "/DPublishDir=$publishDir" $iss
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup falhou.' }

Write-Host "Instalador: $(Join-Path $root "artifacts\SAGRA-Letreiro-Setup-$version.exe")"
