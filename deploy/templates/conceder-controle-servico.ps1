# Concede start/stop/query apenas aos servicos de sync SAGRA para a conta da API.
# Execute como Administrador no servidor de producao.
#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$Account,
    # Exemplos: "NT AUTHORITY\SYSTEM", "DOMINIO\usuario", ".\sagra-api"
    [string[]]$ServiceNames = @(
        "SAGRA-SyncAndamentos",
        "SAGRA-MonitorSyncAndamentos"
    ),
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
Write-Host ("Conta: {0}" -f $Account)
Write-Host ("Servicos: {0}" -f ($ServiceNames -join ', '))

function Get-AccountSid([string]$Name) {
    $nt = New-Object System.Security.Principal.NTAccount($Name)
    try {
        return $nt.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        throw ("Nao foi possivel resolver SID de '{0}': {1}" -f $Name, $_)
    }
}

$sid = Get-AccountSid -Name $Account
Write-Host ("SID: {0}" -f $sid)

# ACE: CC=QueryConfig LC=QueryStatus SW=EnumDeps RP=Start WP=Stop DT=Interrogate LO=QueryLim RC=ReadControl
$ace = "(A;;CCLCSWRPWPDTLOCRRC;;;$sid)"

foreach ($svc in $ServiceNames) {
    $raw = & sc.exe sdshow $svc 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("sc sdshow falhou para {0}: {1}" -f $svc, $raw)
        continue
    }
    $sddl = ($raw -split "`r?`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -First 1)
    if ($sddl) { $sddl = $sddl.Trim() }
    if (-not $sddl) {
        Write-Warning ("SDDL vazio para {0}" -f $svc)
        continue
    }
    if ($sddl -like ("*{0}*" -f $sid)) {
        Write-Host ("OK {0} ja contem ACE para este SID" -f $svc)
        continue
    }

    if ($sddl.StartsWith("D:")) {
        $newSddl = "D:" + $ace + $sddl.Substring(2)
    } else {
        $newSddl = "D:" + $ace + $sddl
    }

    Write-Host ("Atualizando {0}" -f $svc)
    Write-Host ("  OLD: {0}" -f $sddl)
    Write-Host ("  NEW: {0}" -f $newSddl)
    if ($WhatIf) {
        Write-Host "WhatIf=true - nao aplicando"
        continue
    }
    & sc.exe sdset $svc $newSddl | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("sc sdset falhou para {0} (exit={1})" -f $svc, $LASTEXITCODE)
    } else {
        Write-Host ("OK {0} atualizado" -f $svc)
    }
}

Write-Host "Concluido. Teste (como a conta da API): sc query SAGRA-SyncAndamentos"
