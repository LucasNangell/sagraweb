#Requires -Version 5.1
<#
.SYNOPSIS
  Inicia a API SAGRA em segundo plano (sem pause) - uso em deploy remoto / tarefa agendada.
#>
param(
    [string]$Root = ""
)

if (-not $Root) {
    $Root = $PSScriptRoot
}

$ErrorActionPreference = "Stop"
$backend = Join-Path $Root "app\backend"
$envFile = Join-Path $Root "config\.env"
$port = "8050"

$pyPath = @()
if (Test-Path (Join-Path $Root "python_pkgs")) {
    $pyPath += (Join-Path $Root "python_pkgs")
}
$pyPath += $backend
$pyPath += (Join-Path $Root "app\services")
$env:PYTHONPATH = ($pyPath -join ";")

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)=(.*)$") {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim()
            switch ($k) {
                "DB_HOST" { $env:SAGRA_DB_HOST = $v }
                "DB_USER" { $env:SAGRA_DB_USER = $v }
                "DB_PASSWORD" { $env:SAGRA_DB_PASSWORD = $v }
                "DB_NAME" { $env:SAGRA_DB_NAME = $v }
                "PORT" { $env:SAGRA_SERVER_PORT = $v; $port = $v }
                "ENV" { $env:SAGRA_ENV = $v }
            }
        }
    }
}

$freePs = Join-Path $Root "liberar-porta-api.ps1"
if (Test-Path $freePs) {
    & $freePs -Port $port | Out-Null
}

$logDir = Join-Path $Root "logs\api"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stdout = Join-Path $logDir "uvicorn_stdout.log"
$stderr = Join-Path $logDir "uvicorn_stderr.log"

Push-Location $backend
try {
    # Com ErrorActionPreference=Stop, stderr do python (ex.: warning dotenv) vira
    # NativeCommandError mesmo com 2>$null. Isolar as chamadas curtas.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & python -c "from config_manager import config_manager; config_manager.write_client_config_js()" 2>&1 | Out-Null
    } catch {
        # write_client_config_js e best-effort; nao aborta o start da API
        Write-Warning "write_client_config_js: $_"
    }

    $syncCmd = Join-Path $Root "_iniciar-sync-andamentos.cmd"
    $startSync = "0"
    try {
        $raw = & python -c "from config_manager import config_manager; print(1 if config_manager.is_sync_andamentos_enabled() else 0)" 2>&1
        $line = @($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) | Select-Object -Last 1
        if ($line) {
            $startSync = $line.ToString().Trim()
        }
    } catch {
        $startSync = "0"
    }
    $ErrorActionPreference = $prevEap

    if ($startSync -eq "1") {
        if (Test-Path -LiteralPath $syncCmd) {
            $syncArg = "title SAGRA-SYNC-ANDAMENTOS && call `"$syncCmd`" `"$Root`""
            Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $syncArg -WorkingDirectory $Root -WindowStyle Normal | Out-Null
        }
    }
    $args = @(
        "-m", "uvicorn", "routers.api:app",
        "--host", "127.0.0.1",
        "--port", $port,
        "--proxy-headers",
        "--forwarded-allow-ips", "127.0.0.1,10.1.1.73"
    )
    Start-Process -FilePath "python" -ArgumentList $args `
        -WorkingDirectory $backend -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
} finally {
    Pop-Location
}
