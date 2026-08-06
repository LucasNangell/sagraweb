# Testa rotas do Caddy e grava evidencias em debug-8dc98a.log
param(
    [string]$BaseUrl = "https://cgrafsysvm.redecamara.camara.gov.br",
    [string]$LogFile = "C:\dev\SagraWeb\debug-8dc98a.log"
)

$paths = @(
    "/saagi/",
    "/estoque/",
    "/host/",
    "/obs/",
    "/apogee/",
    "/backup/",
    "/",
    "/login"
)

if (Test-Path $LogFile) { Remove-Item $LogFile -Force }

foreach ($p in $paths) {
    $url = "$BaseUrl$p"
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    try {
        $resp = Invoke-WebRequest -Uri $url -MaximumRedirection 0 -SkipCertificateCheck -ErrorAction SilentlyContinue
        $status = $resp.StatusCode
        $location = $resp.Headers["Location"]
        $debugRoute = $resp.Headers["X-Debug-Route"]
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        $location = $_.Exception.Response.Headers["Location"]
        $debugRoute = $_.Exception.Response.Headers["X-Debug-Route"]
    }

    $entry = @{
        sessionId    = "8dc98a"
        runId        = "route-probe"
        hypothesisId = "H1"
        location     = "probe-routes.ps1"
        message      = "route probe"
        data         = @{
            path       = $p
            url        = $url
            status     = $status
            location   = "$location"
            debugRoute = "$debugRoute"
        }
        timestamp = $ts
    } | ConvertTo-Json -Compress

    Add-Content -Path $LogFile -Value $entry -Encoding UTF8
    Write-Host "$p -> status=$status route=$debugRoute location=$location"
}
