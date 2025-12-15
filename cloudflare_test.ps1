# ==========================================
# SCRIPT: Testar Cloudflare Tunnel
# ==========================================
# Testa todas as rotas e valida segurança

param(
    [string]$Domain = "cgraf.online"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TESTE DO CLOUDFLARE TUNNEL" -ForegroundColor Cyan
Write-Host "  Domínio: $Domain" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "https://$Domain"
$localUrl = "http://localhost:8000"

# Função para testar URL
function Test-Url {
    param(
        [string]$Url,
        [string]$Description,
        [bool]$ShouldSucceed = $true
    )
    
    Write-Host "Testando: $Description" -ForegroundColor Cyan
    Write-Host "  URL: $Url" -ForegroundColor Gray
    
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop -TimeoutSec 10
        $statusCode = $response.StatusCode
        
        if ($ShouldSucceed) {
            if ($statusCode -eq 200) {
                Write-Host "  ✅ SUCESSO (Status: $statusCode)" -ForegroundColor Green
                return $true
            } else {
                Write-Host "  ⚠️  AVISO: Status inesperado: $statusCode" -ForegroundColor Yellow
                return $false
            }
        } else {
            Write-Host "  ❌ FALHA: Deveria estar bloqueada mas retornou $statusCode" -ForegroundColor Red
            return $false
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        
        if (-not $ShouldSucceed) {
            if ($statusCode -eq 403 -or $statusCode -eq 404) {
                Write-Host "  ✅ BLOQUEADA corretamente (Status: $statusCode)" -ForegroundColor Green
                return $true
            }
        }
        
        Write-Host "  ❌ ERRO: $($_.Exception.Message)" -ForegroundColor Red
        if ($statusCode) {
            Write-Host "     Status Code: $statusCode" -ForegroundColor Gray
        }
        return $false
    }
    
    Write-Host ""
}

# ========================================
# TESTE 1: Acesso Externo (via Cloudflare)
# ========================================
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host " TESTE 1: ACESSO EXTERNO (Cloudflare)" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

$results = @{
    passed = 0
    failed = 0
}

# Páginas que DEVEM estar acessíveis
Write-Host "🔓 Páginas públicas (devem funcionar):" -ForegroundColor White
Write-Host ""
if (Test-Url "$baseUrl/client_pt.html" "Página client_pt.html" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/client_proof.html" "Página client_proof.html" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/styles.css" "Arquivo CSS" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/health" "Health Check" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""

# Páginas que DEVEM estar bloqueadas
Write-Host "🔒 Páginas internas (devem estar bloqueadas):" -ForegroundColor White
Write-Host ""
if (Test-Url "$baseUrl/" "Página inicial" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/index.html" "Index" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/gerencia.html" "Gerência" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/analise.html" "Análise" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/dashboard_setor.html" "Dashboard" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/email.html" "Email" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$baseUrl/api/os/search" "API Interna" $false) { $results.passed++ } else { $results.failed++ }
Write-Host ""

# ========================================
# TESTE 2: Acesso Local (bypass Cloudflare)
# ========================================
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host " TESTE 2: ACESSO LOCAL (Sem Cloudflare)" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

Write-Host "🏠 Páginas internas (devem funcionar localmente):" -ForegroundColor White
Write-Host ""
if (Test-Url "$localUrl/index.html" "Index local" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$localUrl/gerencia.html" "Gerência local" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""
if (Test-Url "$localUrl/health" "Health local" $true) { $results.passed++ } else { $results.failed++ }
Write-Host ""

# ========================================
# RESUMO
# ========================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RESUMO DOS TESTES" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✅ Testes aprovados: $($results.passed)" -ForegroundColor Green
Write-Host "  ❌ Testes falhados:  $($results.failed)" -ForegroundColor $(if ($results.failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($results.failed -eq 0) {
    Write-Host "🎉 TODOS OS TESTES PASSARAM!" -ForegroundColor Green
    Write-Host ""
    Write-Host "✅ Segurança validada:" -ForegroundColor Green
    Write-Host "   • Páginas públicas acessíveis externamente" -ForegroundColor White
    Write-Host "   • Páginas internas bloqueadas externamente" -ForegroundColor White
    Write-Host "   • Acesso local funcionando normalmente" -ForegroundColor White
} else {
    Write-Host "⚠️  ALGUNS TESTES FALHARAM!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Verifique:" -ForegroundColor Yellow
    Write-Host "   • Túnel está rodando?" -ForegroundColor White
    Write-Host "   • DNS configurado corretamente?" -ForegroundColor White
    Write-Host "   • Servidor backend está ativo?" -ForegroundColor White
    Write-Host "   • Middleware de segurança instalado?" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
