param(
    [int]$Port = 8001
)

Write-Host "Starting SAGRA dev API on port $Port"

# Activate venv if exists
$venv = Join-Path $PSScriptRoot '..\.venv\Scripts\Activate.ps1'
if (Test-Path $venv) {
    Write-Host "Activating virtualenv"
    & $venv
}

# Start uvicorn
python -m uvicorn routers.api:app --host 0.0.0.0 --port $Port
