<#
.SYNOPSIS
  Gera o APK do app "SAGRA Manutenção" e (opcional) publica para auto-atualização.

.DESCRIPTION
  - Release (padrão): assina com a chave do app. Se ainda não existir, cria uma
    em %USERPROFILE%\.sagra\ — FAÇA BACKUP: sem a mesma chave os celulares não
    conseguem atualizar (seria preciso desinstalar e instalar de novo).
  - Gera dist\sagra-manutencao-<versão>.apk e dist\versao.json (sha256, tamanho).
  - -PublicarEm <pasta>: copia APK + versao.json para a pasta lida pela API
    (produção: shared\storage\manutencao_app). -PublicarLocal usa storage\ do DEV.

  Antes de publicar uma nova versão, incremente VERSION_CODE em version.properties.

.EXAMPLE
  powershell -File mobile-manutencao\scripts\build-apk.ps1 -PublicarLocal
.EXAMPLE
  powershell -File mobile-manutencao\scripts\build-apk.ps1 -PublicarEm "\\cgrafsysvm\Sistemas CGraf\Sagra Web\shared\storage\manutencao_app" -Notas "Correções"
#>
param(
  [switch]$Debug,
  [string]$PublicarEm,
  [switch]$PublicarLocal,
  [string]$Notas = "",
  [string]$BaseUrl
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $Root
Set-Location $Root

function Get-JavaMajor([string]$javaHome) {
  $javaExe = Join-Path $javaHome "bin\java.exe"
  if (-not (Test-Path $javaExe)) { return $null }
  $out = & cmd /c "`"$javaExe`" -version 2>&1"
  $m = [regex]::Match(($out -join "`n"), 'version "(\d+)')
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return $null
}

if (-not $env:JAVA_HOME -or (Get-JavaMajor $env:JAVA_HOME) -lt 17) {
  $studioJbr = "C:\Program Files\Android\Android Studio\jbr"
  if (Test-Path (Join-Path $studioJbr "bin\java.exe")) { $env:JAVA_HOME = $studioJbr }
  else { throw "JDK 17+ necessário (defina JAVA_HOME)." }
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw "ANDROID_HOME / ANDROID_SDK_ROOT não definido."
}

$props = @{}
Get-Content (Join-Path $Root "version.properties") | Where-Object { $_ -match "^\s*[A-Z_]+=" } | ForEach-Object {
  $k, $v = $_ -split "=", 2; $props[$k.Trim()] = $v.Trim()
}
$versionCode = [int]$props["VERSION_CODE"]
$versionName = $props["VERSION_NAME"]
Write-Host "==> SAGRA Manutenção $versionName (code $versionCode)" -ForegroundColor Cyan

$gradleArgs = @("--console=plain")
if ($BaseUrl) { $gradleArgs += "-PsagraBaseUrl=$BaseUrl" }

if ($Debug) {
  & .\gradlew.bat assembleDebug @gradleArgs
  if ($LASTEXITCODE -ne 0) { throw "Falha no build debug" }
  $apk = Join-Path $Root "app\build\outputs\apk\debug\app-debug.apk"
  Write-Host "==> APK debug: $apk" -ForegroundColor Green
  return
}

# ----------------------------------------------------------- chave de release
$signing = $env:SAGRA_MANUTENCAO_SIGNING
if (-not $signing) { $signing = Join-Path $env:USERPROFILE ".sagra\sagra-manutencao-signing.properties" }
if (-not (Test-Path $signing)) {
  $dir = Split-Path -Parent $signing
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $keystore = Join-Path $dir "sagra-manutencao.jks"
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $senha = [Convert]::ToBase64String($bytes) -replace "[+/=]", "x"
  Write-Host "==> Criando chave de assinatura em $keystore" -ForegroundColor Yellow
  & (Join-Path $env:JAVA_HOME "bin\keytool.exe") -genkeypair -v -keystore $keystore -alias sagra-manutencao `
    -keyalg RSA -keysize 2048 -validity 10000 -storepass $senha -keypass $senha `
    -dname "CN=SAGRA Manutencao, OU=SEFOC, O=Camara dos Deputados, C=BR" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "keytool falhou" }
  @(
    "storeFile=$($keystore -replace '\\','/')",
    "storePassword=$senha",
    "keyAlias=sagra-manutencao",
    "keyPassword=$senha"
  ) | Set-Content -Path $signing -Encoding ASCII
  Write-Host "    ATENÇÃO: faça backup de $dir (chave + senha). Sem ela não há como atualizar o app." -ForegroundColor Yellow
}
$env:SAGRA_MANUTENCAO_SIGNING = $signing

& .\gradlew.bat assembleRelease @gradleArgs
if ($LASTEXITCODE -ne 0) { throw "Falha no build release" }
$built = Join-Path $Root "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $built)) { throw "APK assinado não encontrado (verifique a chave em $signing)" }

# ----------------------------------------------------------------- dist/
$dist = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$arquivo = "sagra-manutencao-$versionName.apk"
$apk = Join-Path $dist $arquivo
Copy-Item $built $apk -Force
$sha = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
$meta = [ordered]@{
  version_code = $versionCode
  version_name = $versionName
  arquivo      = $arquivo
  sha256       = $sha
  tamanho      = (Get-Item $apk).Length
  publicado_em = (Get-Date).ToString("s")
  notas        = $Notas
}
$json = $meta | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $dist "versao.json"), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "==> $apk" -ForegroundColor Green
Write-Host "    sha256 $sha"

if ($PublicarLocal -and -not $PublicarEm) { $PublicarEm = Join-Path $RepoRoot "storage\manutencao_app" }
if ($PublicarEm) {
  New-Item -ItemType Directory -Force -Path $PublicarEm | Out-Null
  # APK primeiro; versao.json por último (clientes nunca veem versão sem arquivo).
  Copy-Item $apk (Join-Path $PublicarEm $arquivo) -Force
  Copy-Item (Join-Path $dist "versao.json") (Join-Path $PublicarEm "versao.json") -Force
  Write-Host "==> Publicado em $PublicarEm" -ForegroundColor Green
}
