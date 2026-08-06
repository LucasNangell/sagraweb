# Valida Caddyfile e grava resultado em debug-8dc98a.log (sessao de debug)
param(
    [string]$CaddyExe = "C:\nginx\caddy\caddy.exe",
    [string]$Caddyfile = "C:\nginx\caddy\Caddyfile",
    [string]$LogFile = "C:\dev\SagraWeb\debug-8dc98a.log"
)

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$out = & $CaddyExe validate --config $Caddyfile 2>&1 | Out-String
$ok = $LASTEXITCODE -eq 0

$entry = @{
    sessionId = "8dc98a"
    runId     = "validate"
    hypothesisId = "H1"
    location  = "validate-caddy.ps1"
    message   = if ($ok) { "caddy validate OK" } else { "caddy validate FAILED" }
    data      = @{
        exitCode = $LASTEXITCODE
        output   = $out.Trim()
        caddyfile = $Caddyfile
    }
    timestamp = $ts
} | ConvertTo-Json -Compress

Add-Content -Path $LogFile -Value $entry -Encoding UTF8
Write-Host $out
exit $LASTEXITCODE
