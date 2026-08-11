# Instala/atualiza o servico Windows SAGRA-SyncAndamentos via NSSM.
# Requer elevacao (Administrador). Idempotente.
param(
    [string]$Root = "",
    [string]$NssmPath = "",
    [string]$PythonExe = "",
    [string]$ServiceName = "SAGRA-SyncAndamentos",
    [string]$DisplayName = "SAGRA Sync Andamentos",
    [switch]$Start,
    [switch]$InstallDeps
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Execute este script como Administrador."
    }
}

function Resolve-Nssm([string]$Hint, [string]$RootPath) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    $candidates += (Join-Path $RootPath "deploy\tools\nssm.exe")
    $candidates += (Join-Path $RootPath "tools\nssm.exe")
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    throw @"
nssm.exe nao encontrado.
Opcoes:
  1) Passe -NssmPath C:\caminho\nssm.exe
  2) Copie nssm.exe para $RootPath\deploy\tools\nssm.exe
  3) Adicione nssm.exe ao PATH
Download: https://nssm.cc/download
"@
}

function Resolve-Python([string]$Hint) {
    if ($Hint -and (Test-Path -LiteralPath $Hint)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "python.exe nao encontrado. Passe -PythonExe ou adicione ao PATH."
}

function Invoke-PythonCheck([string]$PythonExe, [string]$Code) {
    # Servico NSSM roda como SYSTEM: nao ve %APPDATA%\Python\...\site-packages do usuario.
    $prev = $env:PYTHONNOUSERSITE
    $env:PYTHONNOUSERSITE = "1"
    try {
        $output = & $PythonExe -c $Code 2>&1
        $code = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $code; Output = ($output | Out-String).Trim() }
    } finally {
        if ($null -eq $prev) { Remove-Item Env:\PYTHONNOUSERSITE -ErrorAction SilentlyContinue }
        else { $env:PYTHONNOUSERSITE = $prev }
    }
}

function Test-PythonModuleSystem([string]$PythonExe, [string]$ModuleName) {
    $r = Invoke-PythonCheck -PythonExe $PythonExe -Code "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)"
    return ($r.ExitCode -eq 0)
}

function Get-PythonModulePath([string]$PythonExe, [string]$ModuleName) {
    $r = Invoke-PythonCheck -PythonExe $PythonExe -Code "import $ModuleName,sys; print(getattr($ModuleName,'__file__', $ModuleName))"
    if ($r.ExitCode -eq 0) { return $r.Output }
    return $null
}

function Install-SyncPythonDepsSystem([string]$PythonExe, [string]$RootPath, [string[]]$Packages) {
    Write-Host "Instalando (site-packages do SISTEMA, sem --user): $($Packages -join ', ')"
    $prevUser = $env:PIP_USER
    $prevNoUserSite = $env:PYTHONNOUSERSITE
    $env:PIP_USER = "0"
    $env:PYTHONNOUSERSITE = "1"
    try {
        $wheels = Join-Path $RootPath "wheels"
        if (Test-Path -LiteralPath $wheels) {
            & $PythonExe -m pip install --upgrade --force-reinstall --no-user --no-index --find-links=$wheels @Packages
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Offline wheels falhou; tentando PyPI..."
                & $PythonExe -m pip install --upgrade --force-reinstall --no-user @Packages
            }
        } else {
            & $PythonExe -m pip install --upgrade --force-reinstall --no-user @Packages
        }
        if ($LASTEXITCODE -ne 0) {
            throw "pip install falhou (exit=$LASTEXITCODE)"
        }
    } finally {
        if ($null -eq $prevUser) { Remove-Item Env:\PIP_USER -ErrorAction SilentlyContinue } else { $env:PIP_USER = $prevUser }
        if ($null -eq $prevNoUserSite) { Remove-Item Env:\PYTHONNOUSERSITE -ErrorAction SilentlyContinue } else { $env:PYTHONNOUSERSITE = $prevNoUserSite }
    }
}

function Ensure-SyncPythonDeps([string]$PythonExe, [string]$RootPath, [switch]$InstallDeps) {
    Write-Host "Verificando deps com PYTHONNOUSERSITE=1 (mesmo ambiente do servico SYSTEM)..."
    Write-Host "Python: $PythonExe"
    $pyInfo = Invoke-PythonCheck -PythonExe $PythonExe -Code "import sys; print(sys.executable); print(sys.version.split()[0]); print(sys.path[-1] if sys.path else '')"
    Write-Host $pyInfo.Output

    $needed = @(
        [pscustomobject]@{ Module = "pyodbc"; Package = "pyodbc" },
        [pscustomobject]@{ Module = "mysql.connector"; Package = "mysql-connector-python" },
        [pscustomobject]@{ Module = "requests"; Package = "requests" },
        [pscustomobject]@{ Module = "dotenv"; Package = "python-dotenv" }
    )
    $missing = @()
    foreach ($item in $needed) {
        if (Test-PythonModuleSystem -PythonExe $PythonExe -ModuleName $item.Module) {
            $loc = Get-PythonModulePath -PythonExe $PythonExe -ModuleName $item.Module
            Write-Host "OK sistema: $($item.Module) -> $loc"
        } else {
            Write-Host "AUSENTE no sistema: $($item.Module) (pip: $($item.Package))"
            $missing += $item
        }
    }

    if ($missing.Count -eq 0) { return }

    $pkgList = @($missing | ForEach-Object { $_.Package }) | Select-Object -Unique
    if (-not $InstallDeps) {
        throw @"
Python do SISTEMA nao tem: $($pkgList -join ', ')

O servico NSSM roda como SYSTEM e NAO usa site-packages do seu usuario.
Instale no servidor (Admin):

  `"$PythonExe`" -m pip install --upgrade --force-reinstall --no-user $($pkgList -join ' ')

Ou:

  .\instalar-servico-sync.ps1 -Start -InstallDeps
"@
    }

    Install-SyncPythonDepsSystem -PythonExe $PythonExe -RootPath $RootPath -Packages $pkgList

    foreach ($item in $missing) {
        if (-not (Test-PythonModuleSystem -PythonExe $PythonExe -ModuleName $item.Module)) {
            throw "Ainda ausente apos pip (sistema): $($item.Module)"
        }
        $loc = Get-PythonModulePath -PythonExe $PythonExe -ModuleName $item.Module
        Write-Host "OK apos install: $($item.Module) -> $loc"
    }
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)

$scriptName = "sync_andamentos_service.py"
$scriptPy = Join-Path $Root $scriptName
$scriptOld = Join-Path $Root "sync_andamentos_v2_Old.py"
if (-not (Test-Path -LiteralPath $scriptPy)) {
    throw "Arquivo nao encontrado: $scriptPy"
}
if (-not (Test-Path -LiteralPath $scriptOld)) {
    throw "Arquivo obrigatorio nao encontrado: $scriptOld (logica herdada pelo service)."
}

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
$python = Resolve-Python -Hint $PythonExe

Ensure-SyncPythonDeps -PythonExe $python -RootPath $Root -InstallDeps:$InstallDeps

$logsSync = Join-Path $Root "logs\sync"
New-Item -ItemType Directory -Path $logsSync -Force | Out-Null
$prepLogs = Join-Path $Root "preparar-logs.ps1"
if (Test-Path -LiteralPath $prepLogs) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $prepLogs -Root $Root -Quiet
}

$stdoutLog = Join-Path $logsSync "service_stdout.log"
$stderrLog = Join-Path $logsSync "service_stderr.log"

$backend = Join-Path $Root "app\backend"
$services = Join-Path $Root "app\services"
$pythonPath = "$backend;$services"
$pythonPkgs = Join-Path $Root "python_pkgs"
if (Test-Path -LiteralPath $pythonPkgs) {
    $pythonPath = "$pythonPkgs;$pythonPath"
}

Write-Host "Root:         $Root"
Write-Host "NSSM:         $nssm"
Write-Host "Python:       $python"
Write-Host "Script:       $scriptPy"
Write-Host "AppParameters: $scriptName  (relativo ao AppDirectory; evita problema com espacos no caminho)"
Write-Host "ServiceName:  $ServiceName"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Servico ja existe - atualizando configuracao NSSM..."
    if ($existing.Status -in @("Running", "Paused", "StartPending", "StopPending")) {
        Write-Host "Parando servico (status=$($existing.Status))..."
        & $nssm stop $ServiceName
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 500
            $existing.Refresh()
        } while ($existing.Status -ne "Stopped" -and (Get-Date) -lt $deadline)
    }
} else {
    Write-Host "Instalando servico..."
    # Instala so com Application; parametros com path absoluto quebram em pastas com espaco.
    & $nssm install $ServiceName $python
    if ($LASTEXITCODE -ne 0) {
        throw "nssm install falhou (exit=$LASTEXITCODE)"
    }
}

& $nssm set $ServiceName Application $python
# IMPORTANTE: parametro relativo (sem espacos). AppDirectory aponta para a pasta do script.
& $nssm set $ServiceName AppParameters $scriptName
& $nssm set $ServiceName AppDirectory $Root
& $nssm set $ServiceName DisplayName $DisplayName
& $nssm set $ServiceName Description "Sincronizacao unidirecional MDB->MySQL (andamentos) com watchdog e restart automatico."
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout $stdoutLog
& $nssm set $ServiceName AppStderr $stderrLog
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 10485760
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000
# Throttle maior: evita PAUSED quando o processo demora a estabilizar no boot
& $nssm set $ServiceName AppThrottle 20000
& $nssm set $ServiceName AppStopMethodConsole 5000
& $nssm set $ServiceName AppStopMethodSkip 0

# Ambiente do processo: PYTHONPATH + secret de notify (se existir em config\.env)
$envExtra = @(
    "PYTHONPATH=$pythonPath",
    "ENV=production",
    "PYTHONUTF8=1",
    "PYTHONUNBUFFERED=1",
    "PYTHONNOUSERSITE=1"
)
$envFile = Join-Path $Root "config\.env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $k = $line.Substring(0, $eq).Trim()
        $v = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
        if ($k -eq "SAGRA_NOTIFY_SECRET" -and $v) {
            $envExtra += "SAGRA_NOTIFY_SECRET=$v"
            Write-Host "SAGRA_NOTIFY_SECRET carregado de config\.env"
        }
        if ($k -eq "SAGRA_API_INTERNAL_BASE" -and $v) {
            $envExtra += "SAGRA_API_INTERNAL_BASE=$v"
            Write-Host "SAGRA_API_INTERNAL_BASE carregado de config\.env"
        }
    }
}
& $nssm set $ServiceName AppEnvironmentExtra @envExtra

# Reforco via SCM (independente do AppExit do NSSM)
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

# Limpa stderr antigo para nao confundir com falhas atuais
try {
    if (Test-Path -LiteralPath $stderrLog) {
        Set-Content -LiteralPath $stderrLog -Value "" -Encoding UTF8
    }
} catch {}

Write-Host "Configuracao aplicada."
Write-Host "AppParameters (NSSM):"
& $nssm get $ServiceName AppParameters
Write-Host "AppDirectory (NSSM):"
& $nssm get $ServiceName AppDirectory

if ($Start) {
    Write-Host "Iniciando servico..."
    & $nssm start $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName
    Write-Host "Status: $($svc.Status)"

    if ($svc.Status -eq "Paused") {
        Write-Host ""
        Write-Host "AVISO: servico ficou PAUSED (NSSM throttle apos saida rapida do processo)."
        Write-Host "Ultimas linhas de service_stderr.log:"
        if (Test-Path -LiteralPath $stderrLog) {
            Get-Content -LiteralPath $stderrLog -Tail 30 -ErrorAction SilentlyContinue
        } else {
            Write-Host "(arquivo ausente: $stderrLog)"
        }
        Write-Host ""
        Write-Host "Tentando nssm restart..."
        # nssm continue/restart escreve em stderr com "Unexpected status" - nao abortar o script
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $nssm stop $ServiceName 2>$null | Out-Null
        Start-Sleep -Seconds 2
        & $nssm start $ServiceName 2>&1 | ForEach-Object { Write-Host $_ }
        $ErrorActionPreference = $prevEap
        Start-Sleep -Seconds 4
        $svc.Refresh()
        Write-Host "Status apos retry: $($svc.Status)"
        if ($svc.Status -ne "Running") {
            Write-Host "FALHA: servico nao entrou em Running. Veja $stderrLog"
            Write-Host "Se o log mostrar ModuleNotFoundError, rode:"
            Write-Host "  .\instalar-servico-sync.ps1 -Start -InstallDeps"
            exit 1
        }
    }
} else {
    Write-Host "Servico instalado. Para iniciar: nssm start $ServiceName   ou   -Start"
}

Write-Host "Pronto."
exit 0
