# Libera a porta da API SAGRA (Uvicorn) antes de iniciar.
param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSec = 5
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Test-PortInUse([int]$ListenPort) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction Stop)
    } catch {
        $match = netstat -ano | Select-String ":$ListenPort\s" | Select-String "LISTENING|OUVINDO"
        return ($null -ne $match)
    }
}

function Stop-PortProcesses([int]$ListenPort) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction Stop
    } catch {
        $connections = @()
    }
    if (-not $connections) {
        Write-Host "Nenhum listener ativo na porta $ListenPort" -ForegroundColor Yellow
        return
    }
    foreach ($conn in @($connections)) {
        $procId = [int]$conn.OwningProcess
        if ($procId -le 0) { continue }
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "Processo $procId finalizado" -ForegroundColor Green
    }
}

Write-Host "Liberando porta $Port (timeout ${TimeoutSec}s)..."

$deadline = (Get-Date).AddSeconds($TimeoutSec)
do {
    if (-not (Test-PortInUse $Port)) {
        Write-Host "Porta $Port livre."
        exit 0
    }
    Stop-PortProcesses -ListenPort $Port
    if (-not (Test-PortInUse $Port)) {
        Write-Host "Porta $Port livre."
        exit 0
    }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds 1
} while ($true)

Write-Host ""
Write-Host "[ERRO] Porta $Port ainda em uso apos ${TimeoutSec}s." -ForegroundColor Red
netstat -ano | Select-String ":$Port "
exit 1
