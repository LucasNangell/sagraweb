# ==========================================
# SCRIPT: Validação Final do Cloudflare Tunnel
# ==========================================
# Testa se a configuração está correta

param(
    [string]$Domain = "cgraf.online"
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  VALIDAÇÃO CLOUDFLARE TUNNEL" -ForegroundColor Cyan
Write-Host "  Domínio: $Domain" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$baseUrl = "https://$Domain"
$passed = 0
$failed = 0

function Test-Route {
    param(
        [string]$Url,
        [string]$Description,
        [bool]$ShouldWork
    )
    
    Write-Host "Testando: $Description" -ForegroundColor Cyan
    Write-Host "  URL: $Url" -ForegroundColor Gray
    
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $status = $response.StatusCode
        
        if ($ShouldWork) {
            if ($status -eq 200) {
                Write-Host "  ✅ OK: Status $status (esperado)" -ForegroundColor Green
                return $true
            } else {
                Write-Host "  ⚠️  AVISO: Status $status (esperado 200)" -ForegroundColor Yellow
                return $false
            }
        } else {
            Write-Host "  ❌ FALHA: Status $status (deveria estar bloqueada!)" -ForegroundColor Red
            return $false
        }
    } catch {
        $status = $_.Exception.Response.StatusCode.Value__
        
        if (-not $ShouldWork) {
            if ($status -eq 403 -or $status -eq 404) {
                Write-Host "  ✅ BLOQUEADA: Status $status (correto)" -ForegroundColor Green
                return $true
            }
        }
        
        if ($status) {
            Write-Host "  ❌ Status $status" -ForegroundColor Red
        } else {
            Write-Host "  ❌ Erro: $($_.Exception.Message)" -ForegroundColor Red
        }
        return $false
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host " TESTE 1: PÁGINAS PÚBLICAS (devem funcionar)" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

# Nota: Sem token, podem retornar erro de autenticação, mas NÃO 404
Write-Host "ℹ️  Nota: Sem token válido, podem retornar erro de autenticação" -ForegroundColor Cyan
Write-Host "     O importante é que NÃO retornem 404 (rota bloqueada)`n" -ForegroundColor Cyan

if (Test-Route "$baseUrl/client_pt.html" "client_pt.html" $true) { $passed++ } else { $failed++ }
Write-Host ""
if (Test-Route "$baseUrl/client_proof.html" "client_proof.html" $true) { $passed++ } else { $failed++ }
Write-Host ""

Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host " TESTE 2: PÁGINAS INTERNAS (devem estar bloqueadas)" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""

$blockedPages = @(
    @{url="/"; desc="Raiz"},
    @{url="/index.html"; desc="Index"},
    @{url="/gerencia.html"; desc="Gerência"},
    @{url="/analise.html"; desc="Análise"},
    @{url="/email.html"; desc="Email"},
    @{url="/dashboard_setor.html"; desc="Dashboard"}
)

foreach ($page in $blockedPages) {
    if (Test-Route "$baseUrl$($page.url)" $page.desc $false) { $passed++ } else { $failed++ }
    Write-Host ""
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RESUMO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ✅ Testes aprovados: $passed" -ForegroundColor Green
Write-Host "  ❌ Testes falhados:  $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($failed -eq 0) {
    Write-Host "🎉 VALIDAÇÃO COMPLETA!" -ForegroundColor Green
    Write-Host ""
    Write-Host "✅ Segurança confirmada:" -ForegroundColor Green
    Write-Host "   • Páginas de cliente acessíveis" -ForegroundColor White
    Write-Host "   • Páginas internas bloqueadas" -ForegroundColor White
    Write-Host "   • Sistema pronto para produção" -ForegroundColor White
    Write-Host ""
    Write-Host "📋 URLs finais para clientes:" -ForegroundColor Cyan
    Write-Host "   https://$Domain/client_pt.html?token=..." -ForegroundColor White
    Write-Host "   https://$Domain/client_proof.html?token=..." -ForegroundColor White
} else {
    Write-Host "⚠️  VALIDAÇÃO FALHOU!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Verifique:" -ForegroundColor Yellow
    Write-Host "   1. Túnel está rodando? (.\start_cloudflare_prod.ps1)" -ForegroundColor White
    Write-Host "   2. DNS configurado? (CNAME @ → ...cfargotunnel.com)" -ForegroundColor White
    Write-Host "   3. Servidor PROD ativo? (porta 8000)" -ForegroundColor White
    Write-Host "   4. Middleware instalado? (routers/api.py)" -ForegroundColor White
}

Write-Host ""
Write-Host "========================================`n" -ForegroundColor Cyan
