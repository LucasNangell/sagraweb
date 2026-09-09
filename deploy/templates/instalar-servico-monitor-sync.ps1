# Instala/atualiza o servico Windows SAGRA-MonitorSyncAndamentos via NSSM.
# Monitor read-only: COUNT tabandamento MDB vs MySQL; reinicia SyncAndamentos se divergir.
# Requer elevacao (Administrador). Idempotente.
param(
    [string]$Root = "",
    [string]$NssmPath = "",
    [string]$PythonExe = "",
    [string]$ServiceName = "SAGRA-MonitorSyncAndamentos",
    [string]$DisplayName = "SAGRA Monitor Sync Andamentos",
    [switch]$Start,
    [switch]$InstallDeps,
    [switch]$AutoStart,
    [switch]$ManualStart
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
    throw "nssm.exe nao encontrado. Copie para deploy\tools\nssm.exe ou passe -NssmPath."
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

function Ensure-MonitorPythonDeps([string]$PythonExe, [string]$RootPath, [switch]$InstallDeps) {
    $needed = @(
        [pscustomobject]@{ Module = "pyodbc"; Package = "pyodbc" },
        [pscustomobject]@{ Module = "mysql.connector"; Package = "mysql-connector-python" }
    )
    $missing = @()
    foreach ($item in $needed) {
        if (-not (Test-PythonModuleSystem -PythonExe $PythonExe -ModuleName $item.Module)) {
            $missing += $item
        } else {
            Write-Host "OK: $($item.Module)"
        }
    }
    if ($missing.Count -eq 0) { return }
    $pkgList = @($missing | ForEach-Object { $_.Package }) | Select-Object -Unique
    if (-not $InstallDeps) {
        throw "Python do SISTEMA nao tem: $($pkgList -join ', '). Rode com -InstallDeps."
    }
    $env:PIP_USER = "0"
    $env:PYTHONNOUSERSITE = "1"
    $wheels = Join-Path $RootPath "wheels"
    if (Test-Path -LiteralPath $wheels) {
        & $PythonExe -m pip install --upgrade --force-reinstall --no-user --no-index --find-links=$wheels @pkgList
        if ($LASTEXITCODE -ne 0) {
            & $PythonExe -m pip install --upgrade --force-reinstall --no-user @pkgList
        }
    } else {
        & $PythonExe -m pip install --upgrade --force-reinstall --no-user @pkgList
    }
    if ($LASTEXITCODE -ne 0) { throw "pip install falhou (exit=$LASTEXITCODE)" }
}

Assert-Admin

if (-not $Root) {
    $Root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)

$scriptName = "monitor_sync_andamentos_service.py"
$scriptPy = Join-Path $Root $scriptName
if (-not (Test-Path -LiteralPath $scriptPy)) {
    throw "Arquivo nao encontrado: $scriptPy"
}

$nssm = Resolve-Nssm -Hint $NssmPath -RootPath $Root
$python = Resolve-Python -Hint $PythonExe
Ensure-MonitorPythonDeps -PythonExe $python -RootPath $Root -InstallDeps:$InstallDeps

$logsSync = Join-Path $Root "logs\sync"
New-Item -ItemType Directory -Path $logsSync -Force | Out-Null
$prepLogs = Join-Path $Root "preparar-logs.ps1"
if (Test-Path -LiteralPath $prepLogs) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $prepLogs -Root $Root -Quiet
}

$stdoutLog = Join-Path $logsSync "monitor_service_stdout.log"
$stderrLog = Join-Path $logsSync "monitor_service_stderr.log"

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
Write-Host "ServiceName:  $ServiceName"

if ($ManualStart -and $AutoStart) {
    throw "Use apenas -AutoStart ou -ManualStart, nao os dois."
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Servico ja existe - atualizando configuracao NSSM..."
    if ($existing.Status -in @("Running", "Paused", "StartPending", "StopPending")) {
        & $nssm stop $ServiceName
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 500
            $existing.Refresh()
        } while ($existing.Status -ne "Stopped" -and (Get-Date) -lt $deadline)
    }
} else {
    Write-Host "Instalando servico..."
    & $nssm install $ServiceName $python
    if ($LASTEXITCODE -ne 0) {
        throw "nssm install falhou (exit=$LASTEXITCODE)"
    }
}

& $nssm set $ServiceName Application $python
& $nssm set $ServiceName AppParameters $scriptName
& $nssm set $ServiceName AppDirectory $Root
& $nssm set $ServiceName DisplayName $DisplayName
& $nssm set $ServiceName Description "Monitor read-only: compara COUNT CodStatus tabandamento MDB vs MySQL; reinicia SyncAndamentos se divergir."
$nssmStart = if ($ManualStart) { "SERVICE_DEMAND_START" } else { "SERVICE_AUTO_START" }
& $nssm set $ServiceName Start $nssmStart
Write-Host "StartType NSSM: $nssmStart"
& $nssm set $ServiceName AppStdout $stdoutLog
& $nssm set $ServiceName AppStderr $stderrLog
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 10485760
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000
& $nssm set $ServiceName AppThrottle 20000
& $nssm set $ServiceName AppStopMethodConsole 5000
& $nssm set $ServiceName AppStopMethodSkip 0

$envExtra = @(
    "PYTHONPATH=$pythonPath",
    "ENV=production",
    "PYTHONUTF8=1",
    "PYTHONUNBUFFERED=1",
    "PYTHONNOUSERSITE=1"
)
& $nssm set $ServiceName AppEnvironmentExtra @envExtra

# Conta de logon: herdar a do SyncAndamentos (ACE precisa gravar .ldb no share DFS).
$SyncServiceName = "SAGRA-SyncAndamentos"
$syncCim = Get-CimInstance Win32_Service -Filter "Name='$SyncServiceName'" -ErrorAction SilentlyContinue
if ($syncCim) {
    Write-Host "Sync StartName: $($syncCim.StartName)"
    $monitorCim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    Write-Host "Monitor StartName (antes): $(if ($monitorCim) { $monitorCim.StartName } else { '(novo)' })"
    if ($syncCim.StartName -and $syncCim.StartName -ne "LocalSystem" -and $syncCim.StartName -ne "NT AUTHORITY\SYSTEM") {
        Write-Host ""
        Write-Host "IMPORTANTE: SAGRA-SyncAndamentos nao usa LocalSystem."
        Write-Host "Configure a MESMA conta no monitor (senha obrigatoria):"
        Write-Host "  nssm edit $ServiceName"
        Write-Host "  (aba Log on) -> mesma conta de $($syncCim.StartName)"
        Write-Host "Sem isso o ODBC Access falha com -1032 '(unknown)' no UNC/DFS."
        Write-Host ""
    } else {
        Write-Host "Sync e LocalSystem — monitor tambem (padrao NSSM)."
        Write-Host "Se COUNT MDB falhar com -1032, a conta de computador precisa de Modify no share do .mdb (.ldb)."
    }
} else {
    Write-Host "AVISO: servico $SyncServiceName nao encontrado — confira a conta Log on do monitor manualmente."
}

& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

try {
    if (Test-Path -LiteralPath $stderrLog) {
        Set-Content -LiteralPath $stderrLog -Value "" -Encoding UTF8
    }
} catch {}

Write-Host "Configuracao aplicada."

if ($Start) {
    Write-Host "Iniciando servico..."
    & $nssm start $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName
    Write-Host "Status: $($svc.Status)"
    if ($svc.Status -ne "Running") {
        Write-Host "AVISO: status=$($svc.Status). Veja $stderrLog"
        if (Test-Path -LiteralPath $stderrLog) {
            Get-Content -LiteralPath $stderrLog -Tail 30 -ErrorAction SilentlyContinue
        }
    }
} else {
    $hint = if ($ManualStart) {
        "Servico instalado (Start=Manual). Para iniciar: nssm start $ServiceName ou -Start"
    } else {
        "Servico instalado (Start=Automatic). Sobe com o Windows. Para iniciar agora: -Start"
    }
    Write-Host $hint
}

Write-Host "Pronto."
exit 0
