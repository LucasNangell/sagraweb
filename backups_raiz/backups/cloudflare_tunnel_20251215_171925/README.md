# 🔄 RESTORE v1.2.0 - Cloudflare Tunnel

Este script restaura a versão v1.2.0 (Cloudflare Tunnel) do sistema SAGRA.

## ⚠️ ATENÇÃO

Execute este script **SOMENTE** se precisar reverter para esta versão.

---

## 📦 O que será restaurado

- `routers/analise_routes.py` - Geração de links com domínio público
- `launcher.py` - Monitoramento cloudflared
- `configure_public_domain.ps1` - Script de configuração
- `start_cloudflare_prod.ps1` - Script de inicialização
- `validate_cloudflare.ps1` - Script de validação
- Arquivos de documentação CLOUDFLARE_*.md

---

## 🚀 Como Restaurar

### Automático (Recomendado):

```powershell
# Como Administrador
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb\backups\cloudflare_tunnel_20251215_171925
.\RESTORE.ps1
```

### Manual:

1. **Parar servidores:**
   ```powershell
   Get-Process python | Where-Object {$_.Path -like '*SagraWeb*'} | Stop-Process -Force
   Get-Process cloudflared | Stop-Process -Force -ErrorAction SilentlyContinue
   ```

2. **Copiar arquivos:**
   ```powershell
   Copy-Item "analise_routes.py" -Destination "..\..\routers\" -Force
   Copy-Item "launcher.py" -Destination "..\..\" -Force
   Copy-Item "configure_public_domain.ps1" -Destination "..\..\" -Force
   Copy-Item "start_cloudflare_prod.ps1" -Destination "..\..\" -Force
   Copy-Item "validate_cloudflare.ps1" -Destination "..\..\" -Force
   Copy-Item "CLOUDFLARE_*.md" -Destination "..\..\" -Force
   ```

3. **Reiniciar sistema:**
   ```powershell
   cd ..\..
   python main.py
   ```

4. **Iniciar túnel:**
   ```powershell
   .\start_cloudflare_prod.ps1
   ```

---

## ✅ Validação Pós-Restore

Após restaurar, execute:

```powershell
.\validate_cloudflare.ps1
```

Deve mostrar:
- ✅ Páginas públicas acessíveis (client_pt.html, client_proof.html)
- ❌ Páginas internas bloqueadas (/, index.html, gerencia.html, etc.)

---

## 📝 Configuração Necessária

Após restaurar, configure o domínio público:

```powershell
# Como Administrador
.\configure_public_domain.ps1
```

Depois reinicie o backend para aplicar.

---

**Backup criado em:** 15/12/2025 17:19  
**Versão:** v1.2.0  
**Tipo:** Cloudflare Tunnel - Exposição Pública Controlada
