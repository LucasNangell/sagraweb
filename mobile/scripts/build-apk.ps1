param(
  [switch]$Release,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> SAGRA Tablet APK build" -ForegroundColor Cyan
Write-Host "    Root: $Root"

# Capacitor 7 precisa de JDK 21+. Preferir JBR do Android Studio se JAVA_HOME for 17.
$studioJbr = "C:\Program Files\Android\Android Studio\jbr"
function Get-JavaMajor([string]$javaHome) {
  $javaExe = Join-Path $javaHome "bin\java.exe"
  if (-not (Test-Path $javaExe)) { return $null }
  $output = & cmd /c "`"$javaExe`" -version 2>&1"
  $m = [regex]::Match(($output -join "`n"), 'version "(\d+)')
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return $null
}
if (Test-Path (Join-Path $studioJbr "bin\java.exe")) {
  $jbrMajor = Get-JavaMajor $studioJbr
  $currentMajor = if ($env:JAVA_HOME) { Get-JavaMajor $env:JAVA_HOME } else { $null }
  if (-not $currentMajor -or $currentMajor -lt 21) {
    $env:JAVA_HOME = $studioJbr
    $env:Path = "$studioJbr\bin;" + $env:Path
    Write-Host "==> Usando JDK do Android Studio: $studioJbr (Java $jbrMajor)" -ForegroundColor Yellow
  }
}

if (-not $env:JAVA_HOME) {
  throw "JAVA_HOME não definido. Use JDK 21+ (Capacitor 7)."
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw "ANDROID_HOME / ANDROID_SDK_ROOT não definido."
}

Write-Host "==> JAVA_HOME=$env:JAVA_HOME"

if (-not $SkipInstall) {
  Write-Host "==> pnpm install" -ForegroundColor Cyan
  pnpm install
}

Write-Host "==> pnpm build" -ForegroundColor Cyan
pnpm build

Write-Host "==> cap sync android" -ForegroundColor Cyan
npx cap sync android

$localProps = Join-Path $Root "android\local.properties"
$sdkDir = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
$sdkDirUnix = $sdkDir -replace '\\', '/'
@"
sdk.dir=$sdkDirUnix
"@ | Set-Content -Path $localProps -Encoding UTF8
Write-Host "==> Wrote android/local.properties -> $sdkDir"

Push-Location (Join-Path $Root "android")
try {
  if ($Release) {
    if (-not $env:SAGRA_KEYSTORE_PATH -or -not (Test-Path $env:SAGRA_KEYSTORE_PATH)) {
      throw "Release exige SAGRA_KEYSTORE_PATH apontando para um .keystore/.jks válido."
    }
    if (-not $env:SAGRA_KEYSTORE_PASSWORD -or -not $env:SAGRA_KEY_ALIAS -or -not $env:SAGRA_KEY_PASSWORD) {
      throw "Release exige SAGRA_KEYSTORE_PASSWORD, SAGRA_KEY_ALIAS e SAGRA_KEY_PASSWORD."
    }
    Write-Host "==> gradlew assembleRelease" -ForegroundColor Cyan
    .\gradlew.bat assembleRelease `
      "-Pandroid.injected.signing.store.file=$($env:SAGRA_KEYSTORE_PATH)" `
      "-Pandroid.injected.signing.store.password=$($env:SAGRA_KEYSTORE_PASSWORD)" `
      "-Pandroid.injected.signing.key.alias=$($env:SAGRA_KEY_ALIAS)" `
      "-Pandroid.injected.signing.key.password=$($env:SAGRA_KEY_PASSWORD)"
    $apk = Join-Path $Root "android\app\build\outputs\apk\release\app-release.apk"
  } else {
    Write-Host "==> gradlew assembleDebug" -ForegroundColor Cyan
    .\gradlew.bat assembleDebug
    $apk = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path $apk)) {
  throw "APK não encontrado em $apk"
}

Write-Host "==> APK gerado:" -ForegroundColor Green
Write-Host "    $apk"
Get-Item $apk | Format-List FullName, Length, LastWriteTime
