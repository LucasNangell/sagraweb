# 🌐 CLOUDFLARE TUNNEL - CONFIGURAÇÃO COMPLETA

**Data:** 15/12/2025  
**Túnel:** sagra  
**ID:** 27a38465-be6a-4047-9b16-e901676de216  
**Objetivo:** Expor apenas páginas de cliente externamente  

---

## 📋 ÍNDICE

1. [Visão Geral](#visão-geral)
2. [Arquivos Criados](#arquivos-criados)
3. [Segurança Implementada](#segurança-implementada)
4. [Configuração DNS](#configuração-dns)
5. [Instalação do Serviço](#instalação-do-serviço)
6. [Testes](#testes)
7. [Troubleshooting](#troubleshooting)
8. [Reversão](#reversão)

---

## 🎯 VISÃO GERAL

### O Que Foi Implementado

✅ **Config.yml** - Configuração do túnel com regras de roteamento  
✅ **Middleware de Segurança** - Bloqueio de rotas internas via Cloudflare  
✅ **Scripts de Instalação** - Automação do setup como serviço Windows  
✅ **Scripts de Teste** - Validação completa de segurança  

### Páginas Expostas Externamente

🔓 **PERMITIDAS (via Cloudflare):**
- `/client_pt.html` - Página de problemas técnicos para clientes
- `/client_proof.html` - Página de provas para clientes
- `/styles.css` - CSS necessário
- `/api/client/*` - APIs específicas de cliente
- `/health` - Health check

🔒 **BLOQUEADAS (retornam 403 via Cloudflare):**
- `/` (raiz)
- `/index.html`
- `/gerencia.html`
- `/analise.html`
- `/dashboard_setor.html`
- `/email.html`
- `/api/*` (exceto /api/client/*)
- Qualquer outra rota interna

### Acesso Local

✅ **Todas as rotas funcionam normalmente** quando acessadas localmente (10.120.1.12:8000)  
✅ **Sem impacto** no funcionamento DEV ou PROD  

---

## 📦 ARQUIVOS CRIADOS

### 1. Configuração do Túnel

**Local:** `C:\Users\P_918713\.cloudflared\config.yml`

```yaml
tunnel: 27a38465-be6a-4047-9b16-e901676de216
credentials-file: C:\Users\P_918713\.cloudflared\27a38465-be6a-4047-9b16-e901676de216.json

ingress:
  - hostname: sagra.camara.leg.br
    path: /client_pt\.html
    service: http://localhost:8000
  
  - hostname: sagra.camara.leg.br
    path: /client_proof\.html
    service: http://localhost:8000
  
  - hostname: sagra.camara.leg.br
    path: /styles\.css
    service: http://localhost:8000
  
  - hostname: sagra.camara.leg.br
    path: /api/client/.*
    service: http://localhost:8000
  
  - service: http_status:404
```

### 2. Middleware de Segurança

**Local:** [routers/api.py](routers/api.py)

**Classe:** `CloudflareTunnelSecurityMiddleware`

**Funcionalidade:**
- Detecta requisições vindas do Cloudflare (headers CF-Connecting-IP ou CF-RAY)
- Bloqueia acesso externo a rotas internas
- Permite acesso local sem restrições
- Registra tentativas de acesso bloqueadas no log

### 3. Scripts de Instalação

**Script:** [cloudflare_install_service.ps1](cloudflare_install_service.ps1)

**O que faz:**
- Verifica permissões de administrador
- Verifica instalação do cloudflared
- Instala túnel como serviço Windows
- Configura início automático
- Inicia o serviço

**Como usar:**
```powershell
# Executar como Administrador
.\cloudflare_install_service.ps1
```

### 4. Script de Testes

**Script:** [cloudflare_test.ps1](cloudflare_test.ps1)

**O que testa:**
- ✅ Páginas públicas acessíveis via Cloudflare
- ❌ Páginas internas bloqueadas via Cloudflare
- ✅ Todas as páginas funcionando localmente

**Como usar:**
```powershell
.\cloudflare_test.ps1 -Domain "sagra.camara.leg.br"
```

---

## 🔒 SEGURANÇA IMPLEMENTADA

### Duas Camadas de Proteção

#### 1. **Cloudflare Tunnel (config.yml)**
- Define quais rotas são encaminhadas para o backend
- Rotas não definidas retornam 404 imediatamente
- Não chegam ao backend

#### 2. **Middleware Backend (FastAPI)**
- Detecta origem Cloudflare via headers
- Valida rota mesmo que passe pelo túnel
- Retorna 403 para rotas não permitidas
- Permite tudo quando acesso é local

### Detecção de Cloudflare

O middleware detecta requisições do Cloudflare através dos headers:
- `CF-Connecting-IP` - IP real do cliente
- `CF-RAY` - ID único da requisição Cloudflare

```python
cf_connecting_ip = request.headers.get("CF-Connecting-IP")
cf_ray = request.headers.get("CF-RAY")
is_cloudflare = cf_connecting_ip is not None or cf_ray is not None
```

### Logs de Segurança

Todas as tentativas de acesso via Cloudflare são logadas:

```
INFO: Cloudflare: Acesso permitido a /client_pt.html de 203.0.113.42
WARNING: Cloudflare: Acesso bloqueado a /gerencia.html de 203.0.113.42
```

---

## 🌐 CONFIGURAÇÃO DNS

### Passo a Passo no Cloudflare Dashboard

1. **Acessar o Dashboard:**
   - https://dash.cloudflare.com
   - Selecione o domínio `camara.leg.br`

2. **Criar Registro DNS:**
   - Vá em **DNS** → **Records**
   - Clique em **Add record**

3. **Configurar CNAME:**
   ```
   Type: CNAME
   Name: sagra
   Target: 27a38465-be6a-4047-9b16-e901676de216.cfargotunnel.com
   Proxy status: Proxied (🧡 nuvem laranja)
   TTL: Auto
   ```

4. **Salvar:**
   - Clique em **Save**
   - DNS propaga em segundos (já está no Cloudflare)

### Verificar DNS

```powershell
# Verificar se DNS está configurado
nslookup sagra.camara.leg.br

# Deve retornar IPs do Cloudflare (ex: 104.x.x.x ou 172.x.x.x)
```

### URL Final

Após configuração DNS:
- **Externa:** `https://sagra.camara.leg.br/client_pt.html?token=...`
- **Interna:** `http://10.120.1.12:8000/client_pt.html?token=...` (continua funcionando)

---

## ⚙️ INSTALAÇÃO DO SERVIÇO

### Pré-requisitos

✅ Cloudflared instalado  
✅ Túnel criado (sagra)  
✅ Arquivo credentials existente  
✅ Config.yml criado  

### Instalação Automática

**Executar como Administrador:**

```powershell
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb
.\cloudflare_install_service.ps1
```

O script vai:
1. ✅ Verificar permissões
2. ✅ Verificar cloudflared instalado
3. ✅ Verificar config.yml existe
4. ✅ Instalar serviço Windows
5. ✅ Iniciar serviço
6. ✅ Configurar início automático

### Verificar Instalação

```powershell
# Ver status do serviço
Get-Service cloudflared

# Deve mostrar:
# Status: Running
# StartType: Automatic
```

### Gerenciar Serviço

```powershell
# Iniciar
Start-Service cloudflared

# Parar
Stop-Service cloudflared

# Reiniciar
Restart-Service cloudflared

# Ver logs
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 50
```

### Desinstalar Serviço

```powershell
# Executar como Administrador
Stop-Service cloudflared
cloudflared service uninstall
```

---

## 🧪 TESTES

### Teste Automatizado

```powershell
.\cloudflare_test.ps1 -Domain "sagra.camara.leg.br"
```

**O que é testado:**

✅ **Acesso Externo (via Cloudflare):**
- `/client_pt.html` → Deve funcionar ✅
- `/client_proof.html` → Deve funcionar ✅
- `/styles.css` → Deve funcionar ✅
- `/index.html` → Deve bloquear ❌ (403/404)
- `/gerencia.html` → Deve bloquear ❌
- `/analise.html` → Deve bloquear ❌
- `/dashboard_setor.html` → Deve bloquear ❌
- `/api/os/search` → Deve bloquear ❌

✅ **Acesso Local:**
- Todas as rotas funcionando normalmente

### Teste Manual

#### 1. Teste Externo (via Navegador)

```
✅ DEVE FUNCIONAR:
https://sagra.camara.leg.br/client_pt.html
https://sagra.camara.leg.br/client_proof.html

❌ DEVE SER BLOQUEADO:
https://sagra.camara.leg.br/
https://sagra.camara.leg.br/index.html
https://sagra.camara.leg.br/gerencia.html
```

#### 2. Teste Local (via Rede Interna)

```
✅ TUDO DEVE FUNCIONAR:
http://10.120.1.12:8000/index.html
http://10.120.1.12:8000/gerencia.html
http://10.120.1.12:8000/client_pt.html
```

#### 3. Teste de Link Cliente

1. Gere um link de cliente no sistema (via analise.html)
2. Copie o link gerado
3. Substitua o IP/porta pelo domínio:
   - De: `http://10.120.1.12:8000/client_pt.html?token=abc123`
   - Para: `https://sagra.camara.leg.br/client_pt.html?token=abc123`
4. Teste em navegador externo (celular sem VPN)
5. ✅ Deve funcionar perfeitamente

---

## 🔧 TROUBLESHOOTING

### Problema: Túnel não inicia

**Sintoma:**
```
Get-Service cloudflared
Status: Stopped
```

**Solução:**
```powershell
# Ver logs de erro
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 100

# Testar configuração manualmente
cloudflared tunnel --config C:\Users\P_918713\.cloudflared\config.yml run sagra

# Se funcionar manualmente, reinstalar serviço
cloudflared service uninstall
cloudflared service install
Start-Service cloudflared
```

---

### Problema: DNS não resolve

**Sintoma:**
```
nslookup sagra.camara.leg.br
Server failed
```

**Solução:**
1. Verificar DNS no Cloudflare Dashboard
2. CNAME deve apontar para: `27a38465-be6a-4047-9b16-e901676de216.cfargotunnel.com`
3. Proxy deve estar ativado (🧡 nuvem laranja)
4. Aguardar 1-2 minutos para propagação

---

### Problema: Página pública bloqueada

**Sintoma:**
```
https://sagra.camara.leg.br/client_pt.html
403 Forbidden
```

**Verificar:**

1. **Config.yml contém a rota:**
```yaml
- hostname: sagra.camara.leg.br
  path: /client_pt\.html
  service: http://localhost:8000
```

2. **Middleware permite a rota:**
```python
ALLOWED_PUBLIC_ROUTES = [
    "/client_pt.html",
    # ...
]
```

3. **Backend está rodando:**
```powershell
curl http://localhost:8000/health
```

4. **Ver logs do túnel:**
```powershell
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 50
```

---

### Problema: Página interna não bloqueada

**Sintoma:**
```
https://sagra.camara.leg.br/index.html
200 OK (deveria ser 403)
```

**Solução:**

1. **Verificar se middleware está ativo:**
```python
# Em api.py, deve ter:
app.add_middleware(CloudflareTunnelSecurityMiddleware)
```

2. **Reiniciar servidor backend:**
```powershell
# Parar Python
Get-Process python | Stop-Process -Force

# Iniciar novamente
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb
python main.py
```

3. **Verificar headers Cloudflare:**
```powershell
# Request via Cloudflare deve ter headers CF-*
curl https://sagra.camara.leg.br/health -v
```

---

### Problema: Acesso local bloqueado

**Sintoma:**
```
http://10.120.1.12:8000/index.html
403 Forbidden
```

**Causa:** Middleware bloqueando acesso local

**Solução:**

Verificar lógica do middleware:
```python
# Deve permitir tudo quando não vem do Cloudflare
if not is_cloudflare:
    return await call_next(request)
```

Se necessário, adicionar exceção por IP:
```python
# No início do middleware
if request.client.host.startswith("10.120."):
    return await call_next(request)
```

---

## ↩️ REVERSÃO

### Desativar Túnel (Temporário)

```powershell
# Parar serviço
Stop-Service cloudflared

# Sistema volta a funcionar apenas localmente
```

### Remover Túnel (Permanente)

```powershell
# 1. Parar e desinstalar serviço
Stop-Service cloudflared
cloudflared service uninstall

# 2. Remover DNS do Cloudflare
# Acessar Dashboard → DNS → Deletar registro "sagra"

# 3. Remover middleware (opcional)
# Comentar linha em api.py:
# app.add_middleware(CloudflareTunnelSecurityMiddleware)

# 4. Manter arquivos para possível reativação
```

### Reverter Middleware

Se quiser remover a camada de segurança do backend:

```python
# Em api.py, comentar:
# app.add_middleware(CloudflareTunnelSecurityMiddleware)
```

**Atenção:** O túnel ainda bloqueará via config.yml, mas sem segunda camada de proteção.

---

## 📊 DIAGRAMA DE ARQUITETURA

```
┌─────────────────────────────────────────────────────────┐
│                    INTERNET                              │
│                    (Clientes)                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ https://sagra.camara.leg.br
                     │
┌────────────────────▼────────────────────────────────────┐
│               CLOUDFLARE                                 │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  DNS: sagra.camara.leg.br                      │    │
│  │  → 27a38465...cfargotunnel.com                 │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  Cloudflare Tunnel (sagra)                     │    │
│  │  ├─ config.yml rules                           │    │
│  │  ├─ Permite: /client_*                         │    │
│  │  └─ Bloqueia: tudo o resto (404)               │    │
│  └────────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Encrypted Tunnel
                     │
┌────────────────────▼────────────────────────────────────┐
│         SERVIDOR LOCAL (10.120.1.12)                     │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  Cloudflared Service (Windows)                 │    │
│  │  → Porta: localhost:8000                       │    │
│  └────────────────┬───────────────────────────────┘    │
│                   │                                      │
│  ┌────────────────▼───────────────────────────────┐    │
│  │  FastAPI Backend                               │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────────┐ │    │
│  │  │ CloudflareTunnelSecurityMiddleware       │ │    │
│  │  │ ├─ Detecta: CF-Connecting-IP header      │ │    │
│  │  │ ├─ Permite: páginas públicas             │ │    │
│  │  │ └─ Bloqueia: páginas internas (403)      │ │    │
│  │  └──────────────────────────────────────────┘ │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────────┐ │    │
│  │  │ Application Routes                       │ │    │
│  │  │ ├─ /client_pt.html ✅                    │ │    │
│  │  │ ├─ /client_proof.html ✅                 │ │    │
│  │  │ ├─ /index.html 🔒                        │ │    │
│  │  │ ├─ /gerencia.html 🔒                     │ │    │
│  │  │ └─ /analise.html 🔒                      │ │    │
│  │  └──────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │  Acesso Interno (Sem Cloudflare)              │    │
│  │  http://10.120.1.12:8000                      │    │
│  │  ✅ TODAS as rotas funcionam                  │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## ✅ CHECKLIST FINAL

### Configuração Inicial

- [x] Config.yml criado em `C:\Users\P_918713\.cloudflared\`
- [x] Regras de ingress configuradas
- [x] Middleware de segurança adicionado ao api.py
- [ ] DNS CNAME criado no Cloudflare Dashboard
- [ ] Túnel instalado como serviço Windows
- [ ] Serviço iniciado e rodando

### Testes Funcionais

- [ ] `/client_pt.html` acessível via Cloudflare
- [ ] `/client_proof.html` acessível via Cloudflare
- [ ] `/index.html` bloqueada via Cloudflare (403/404)
- [ ] `/gerencia.html` bloqueada via Cloudflare
- [ ] Todas as rotas funcionando localmente
- [ ] Links de cliente funcionando com novo domínio

### Validação de Segurança

- [ ] Headers CF-* presentes em requests externos
- [ ] Logs mostrando bloqueios corretos
- [ ] Middleware detectando Cloudflare corretamente
- [ ] Acesso local sem bloqueios

### Produção

- [ ] Serviço rodando estável por 24h
- [ ] Logs sem erros críticos
- [ ] DNS propagado globalmente
- [ ] Clientes externos conseguem acessar
- [ ] Sistema interno funcionando normalmente

---

## 📞 SUPORTE

### Comandos Úteis de Debug

```powershell
# Status do serviço
Get-Service cloudflared | Format-List *

# Logs em tempo real
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Wait -Tail 20

# Testar túnel manualmente
cloudflared tunnel --config C:\Users\P_918713\.cloudflared\config.yml run sagra

# Validar config.yml
cloudflared tunnel ingress validate

# Ver rotas do túnel
cloudflared tunnel ingress rule https://sagra.camara.leg.br/client_pt.html

# Verificar conectividade
Test-NetConnection sagra.camara.leg.br -Port 443
```

### Logs Importantes

1. **Túnel:** `C:\Users\P_918713\.cloudflared\tunnel.log`
2. **Backend:** Console do Python (uvicorn)
3. **Cloudflare Dashboard:** Access → Tunnel → sagra → Logs

---

## 📝 NOTAS FINAIS

### Vantagens da Solução

✅ **Segurança:** Duas camadas de proteção (túnel + middleware)  
✅ **Simplicidade:** Sem autenticação complexa  
✅ **Performance:** Cloudflare CDN global  
✅ **Custo:** Grátis para este volume de tráfego  
✅ **Manutenção:** Serviço Windows automático  
✅ **Reversível:** Pode desativar a qualquer momento  

### Limitações

⚠️ **Dependência:** Requer Cloudflare funcionando  
⚠️ **Latência:** Adiciona ~20-50ms (aceitável)  
⚠️ **Bandwidth:** Sem limites, mas monitorar uso  

### Próximos Passos (Opcional)

📈 **Melhorias Futuras:**
- [ ] Adicionar rate limiting por IP
- [ ] Implementar Web Application Firewall (WAF)
- [ ] Adicionar analytics de acesso
- [ ] Configurar alertas de downtime
- [ ] Backup automático de configurações

---

**Status:** ✅ Configuração completa e documentada  
**Pronto para:** Instalação e testes  
**Impacto:** Zero no sistema existente  
