# Instala/atualiza a API SAGRA (uvicorn) como servico Windows via NSSM.
# Requer Administrador. Idempotente.
#
# A API grava nos MDBs do DFS (\\redecamara\DfsData\...): a conta do servico precisa de
# credencial de rede e permissao de escrita na pasta dos MDBs. Use a mesma conta do
# SAGRA-SyncAndamentos (ex.: REDECAMARA\usr_sefoc). LocalSystem nao e aceito.
#
# Uso (sessao elevada NO SERVIDOR; -ServiceCredential nao funciona via "powershell -File"):
#   & .\instalar-servico-api.ps1 -ServiceCredential (Get-Credential 'REDECAMARA\usr_sefoc') -Start
#Requires -Version 5.1
param(
    [string]$Root = "",
    [string]$NssmPath = "",
    [string]$PythonExe = "",
    [string]$ServiceName = "SAGRA-Api",
    [string]$DisplayName = "SAGRA - API (uvicorn)",
    [string]$WatchdogServiceName = "SAGRA-SystemWatchdog",
    [pscredential]$ServiceCredential,
    [switch]$Start
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$SystemAccounts = @("LocalSystem", "NT AUTHORITY\SYSTEM", "NT AUTHORITY\LocalService", "NT AUTHORITY\NetworkService")

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Execute este script como Administrador."
    }
}

function Resolve-Nssm([string]$Hint, [string[]]$Roots) {
    $candidates = @()
    if ($Hint) { $candidates += $Hint }
    foreach ($r in $Roots) {
        $candidates += (Join-Path $r "deploy\tools\nssm.exe")
        $candidates += (Join-Path $r "tools\nssm.exe")
    }
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $hosted = Get-CimInstance Win32_Service -Filter "Name='SAGRA-SyncAndamentos'" -ErrorAction SilentlyContinue
    if ($hosted -and $hosted.PathName) {
        $binary = ([string]$hosted.PathName).Trim()
        if ($binary.StartsWith('"')) { $binary = $binary.Substring(1, $binary.IndexOf('"', 1) - 1) }
        else { $binary = ($binary -split '\s+')[0] }
        if ((Split-Path $binary -Leaf) -ieq "nssm.exe") { $candidates += $binary }
    }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    throw "nssm.exe nao encontrado. Copie para deploy\tools\nssm.exe ou passe -NssmPath."
}

function Resolve-Python([string]$Hint) {
    if ($Hint -and (Test-Path -LiteralPath $Hint -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $Hint).Path
    }
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        $source = [System.IO.Path]::GetFullPath($cmd.Source)
        foreach ($unsafeRoot in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:TEMP)) {
            if ($unsafeRoot -and $source.StartsWith([System.IO.Path]::GetFullPath($unsafeRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Python do PATH esta em perfil de usuario ($source). Passe -PythonExe com uma instalacao system-wide."
            }
        }
        return $source
    }
    throw "python.exe system-wide nao encontrado. Passe -PythonExe."
}

function Invoke-Nssm([string]$Exe, [string[]]$Arguments, [string]$TolerateOutput = "") {
    $ErrorActionPreference = "Continue"
    $output = (& $Exe @Arguments 2>&1 | Out-String) -replace "\x00", ""
    if ($LASTEXITCODE -ne 0 -and -not ($TolerateOutput -and ($output -replace "\s", "") -match $TolerateOutput)) {
        throw "nssm $($Arguments[0]) $($Arguments[1]) falhou (exit=$LASTEXITCODE): $output"
    }
    return $output
}

function Set-ServiceLogon([string]$Exe, [string]$Name, [pscredential]$Credential) {
    $user = $Credential.UserName
    $password = $Credential.GetNetworkCredential().Password
    # Saida e argumentos nao vao para a excecao: contem a senha.
    $ErrorActionPreference = "Continue"
    $null = & $Exe set $Name ObjectName $user $password 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "nssm set ObjectName falhou para $user (exit=$LASTEXITCODE). Confira usuario/senha e o direito 'Logon as a service'."
    }
}

function Assert-ApiPythonDeps([string]$Python, [string]$PythonPath) {
    # Servico usa PYTHONNOUSERSITE=1: pacotes do perfil de quem instalou nao valem.
    $prevPath = $env:PYTHONPATH
    $prevNoUser = $env:PYTHONNOUSERSITE
    $env:PYTHONPATH = $PythonPath
    $env:PYTHONNOUSERSITE = "1"
    try {
        $ErrorActionPreference = "Continue"
        $out = & $Python -c "import fastapi, uvicorn, pyodbc, pymysql; print('ok')" 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "Dependencias da API ausentes no Python do sistema (PYTHONNOUSERSITE=1):`n$out"
        }
    } finally {
        $env:PYTHONPATH = $prevPath
        if ($null -eq $prevNoUser) { Remove-Item Env:\PYTHONNOUSERSITE -ErrorAction SilentlyContinue }
        else { $env:PYTHONNOUSERSITE = $prevNoUser }
    }
}

function Read-DotEnvValue([string]$Path, [string]$Key) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        $t = $line.Trim()
        if (-not $t -or $t.StartsWith("#")) { continue }
        $eq = $t.IndexOf("=")
        if ($eq -lt 1) { continue }
        if ($t.Substring(0, $eq).Trim() -eq $Key) {
            return $t.Substring($eq + 1).Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

Assert-Admin
if ($ServiceCredential -and $ServiceCredential.UserName -like "System.Management.Automation.PSCredential*") {
    throw ("-ServiceCredential chegou como texto (chamada via 'powershell -File'). " +
        "Rode na sessao atual: & .\instalar-servico-api.ps1 -ServiceCredential (Get-Credential 'DOMINIO\conta')")
}

if (-not $Root) {
    $scriptParent = Split-Path $PSScriptRoot -Parent
    $Root = if ((Split-Path $PSScriptRoot -Leaf) -ieq "current") {
        $scriptParent
    } elseif ((Split-Path $scriptParent -Leaf) -ieq "releases") {
        Split-Path $scriptParent -Parent
    } else {
        $PSScriptRoot
    }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$currentRoot = Join-Path $Root "current"
if (-not (Test-Path -LiteralPath $currentRoot -PathType Container)) {
    throw "Junction current nao encontrado em $Root. A API como servico exige o layout versionado (current\ + releases\ + shared\)."
}
$backend = Join-Path $currentRoot "app\backend"
if (-not (Test-Path -LiteralPath (Join-Path $backend "routers\api.py") -PathType Leaf)) {
    throw "routers\api.py nao encontrado em $backend"
}

$nssm = Resolve-Nssm -Hint $NssmPath -Roots @($currentRoot, $Root)
$python = Resolve-Python -Hint $PythonExe

$pyPath = @()
$pythonPkgs = Join-Path $currentRoot "python_pkgs"
if (Test-Path -LiteralPath $pythonPkgs) { $pyPath += $pythonPkgs }
$pyPath += $backend
$pyPath += (Join-Path $currentRoot "app\services")
$pythonPath = $pyPath -join ";"
Assert-ApiPythonDeps -Python $python -PythonPath $pythonPath

$envFile = Join-Path $currentRoot "config\.env"
$port = Read-DotEnvValue -Path $envFile -Key "PORT"
if (-not $port) { $port = "8050" }
if ($port -notmatch '^\d{2,5}$') { throw "PORT invalido em config\.env: $port" }

$logDir = Join-Path $Root "shared\logs\api"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stdoutLog = Join-Path $logDir "uvicorn_stdout.log"
$stderrLog = Join-Path $logDir "uvicorn_stderr.log"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    $cim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if (-not $ServiceCredential -and $cim.StartName -in $SystemAccounts) {
        throw "$ServiceName roda como $($cim.StartName). Passe -ServiceCredential com a conta de rede (ex.: REDECAMARA\usr_sefoc)."
    }
    if ($existing.Status -ne "Stopped") {
        Write-Host "Parando $ServiceName (status=$($existing.Status))..."
        $null = Invoke-Nssm -Exe $nssm -Arguments @("stop", $ServiceName)
        try { $existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) } catch { }
    }
} else {
    if (-not $ServiceCredential) {
        throw "Servico novo exige -ServiceCredential (conta com acesso de escrita aos MDBs no DFS, ex.: REDECAMARA\usr_sefoc)."
    }
    Write-Host "Instalando $ServiceName..."
    $null = Invoke-Nssm -Exe $nssm -Arguments @("install", $ServiceName, $python)
}

# AppParameters sem caminhos absolutos: AppDirectory resolve routers.api (pasta com espacos).
$appParameters = "-m uvicorn routers.api:app --host 127.0.0.1 --port $port --proxy-headers --forwarded-allow-ips 127.0.0.1,10.1.1.73"
$nssmSettings = @(
    @("Application", $python),
    @("AppParameters", $appParameters),
    @("AppDirectory", $backend),
    @("DisplayName", $DisplayName),
    @("Description", "API SAGRA Web (FastAPI/uvicorn). Conta de rede obrigatoria: grava nos MDBs do DFS."),
    @("Start", "SERVICE_AUTO_START"),
    @("AppStdout", $stdoutLog),
    @("AppStderr", $stderrLog),
    @("AppRotateFiles", "1"),
    @("AppRotateOnline", "1"),
    @("AppRotateBytes", "10485760"),
    @("AppExit", "Default", "Restart"),
    @("AppRestartDelay", "5000"),
    @("AppThrottle", "30000"),
    @("AppStopMethodConsole", "10000"),
    @("AppStopMethodSkip", "0")
)
foreach ($setting in $nssmSettings) {
    $null = Invoke-Nssm -Exe $nssm -Arguments (@("set", $ServiceName) + $setting)
}

$envExtra = @(
    "PYTHONPATH=$pythonPath",
    "ENV=production",
    "PYTHONUTF8=1",
    "PYTHONUNBUFFERED=1",
    "PYTHONNOUSERSITE=1"
)
$null = Invoke-Nssm -Exe $nssm -Arguments (@("set", $ServiceName, "AppEnvironmentExtra") + $envExtra)

if ($ServiceCredential) {
    Set-ServiceLogon -Exe $nssm -Name $ServiceName -Credential $ServiceCredential
}
$account = [string](Get-CimInstance Win32_Service -Filter "Name='$ServiceName'").StartName
if ($account -in $SystemAccounts) {
    throw "$ServiceName ficou como $account; a API nao gravaria nos MDBs do DFS. Reinstale com -ServiceCredential."
}

& "$env:SystemRoot\System32\sc.exe" failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null
& "$env:SystemRoot\System32\sc.exe" failureflag $ServiceName 1 | Out-Null

# Watchdog reinicia a API pelo SCM: a conta dele precisa de start/stop neste servico.
$wd = Get-CimInstance Win32_Service -Filter "Name='$WatchdogServiceName'" -ErrorAction SilentlyContinue
if ($wd -and $wd.StartName -and $wd.StartName -notin $SystemAccounts) {
    $grantScript = Join-Path $PSScriptRoot "conceder-controle-servico.ps1"
    if (Test-Path -LiteralPath $grantScript -PathType Leaf) {
        & $grantScript -Account $wd.StartName -ServiceNames @($ServiceName)
    } else {
        Write-Warning "conceder-controle-servico.ps1 ausente: conceda start/stop de $ServiceName a $($wd.StartName) manualmente."
    }
}

Write-Host "Servico configurado: $ServiceName"
Write-Host "  Conta:        $account"
Write-Host "  Python:       $python"
Write-Host "  AppDirectory: $backend"
Write-Host "  Porta:        $port"
Write-Host "  Logs:         $logDir"

if ($Start) {
    # Encerra API solta (iniciar-api-detached / console) que esteja segurando a porta.
    $loose = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "uvicorn\s+routers\.api:app" -and $_.CommandLine -match "--port\s+$port\b" }
    foreach ($p in $loose) {
        Write-Host "Encerrando API fora do servico: PID $($p.ProcessId)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $null = Invoke-Nssm -Exe $nssm -Arguments @("start", $ServiceName) -TolerateOutput "START_PENDING"
    $svc = Get-Service -Name $ServiceName
    try { $svc.WaitForStatus("Running", [TimeSpan]::FromSeconds(60)) } catch { }
    $svc.Refresh()
    Write-Host "Status: $($svc.Status)"
    if ($svc.Status -ne "Running") {
        Write-Host "Ultimas linhas de ${stderrLog}:"
        Get-Content -LiteralPath $stderrLog -Tail 40 -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Host "Reinstale o watchdog com -ApiServiceName $ServiceName para que ele reinicie a API pelo servico."
}
exit 0
