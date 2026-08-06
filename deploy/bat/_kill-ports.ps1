param()

$ErrorActionPreference = 'SilentlyContinue'

if ($args.Count -eq 0) {
    $Ports = @(8001, 5173)
} else {
    $Ports = @($args | ForEach-Object { [int]$_ })
}

$killed = 0
$seen = @{}

foreach ($port in $Ports) {
    if ($port -le 0) { continue }

    $connections = @(
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    )
    if ($connections.Count -eq 0) {
        $connections = @(
            Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
                Where-Object { $_.State -in @('Listen', 'Listening') }
        )
    }

    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($procId in $pids) {
        if ($null -eq $procId -or $procId -le 0) { continue }
        if ($seen.ContainsKey($procId)) { continue }
        $seen[$procId] = $true

        $procName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Write-Host "Encerrando porta $port - PID $procId ($procName)"

        & taskkill.exe /F /PID $procId /T 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
        $killed++
    }
}

if ($killed -eq 0) {
    Write-Host "Nenhum processo em escuta nas portas: $($Ports -join ', ')"
} else {
    Write-Host ""
    Write-Host "$killed processo(s) finalizado(s)."
}

exit 0
