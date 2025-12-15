# 🔗 CONFIGURAÇÃO DE URLs - Cloudflare Tunnel

## 📌 Como o Sistema Gera Links

### Geração Automática (Já Implementado)

O sistema em [routers/analise_routes.py](routers/analise_routes.py) já gera URLs baseadas no **referer** do request:

```python
# Detecta automaticamente de onde veio o request
host_url = "http://localhost:8001" # Fallback
if request.headers.get("referer"):
    from urllib.parse import urlparse
    parsed = urlparse(request.headers.get("referer"))
    host_url = f"{parsed.scheme}://{parsed.netloc}"

final_url = f"{host_url}/client_pt.html?os={os_id}&ano={ano}&token={token}"
```

### Comportamento Esperado

| Acesso de onde | Referer | Link Gerado |
|---------------|---------|-------------|
| `http://10.120.1.12:8000/analise.html` | `http://10.120.1.12:8000/...` | `http://10.120.1.12:8000/client_pt.html?...` |
| `https://sagra.camara.leg.br/analise.html` | `https://sagra.camara.leg.br/...` | `https://sagra.camara.leg.br/client_pt.html?...` |
| API direta (Postman) | (vazio) | `http://localhost:8001/client_pt.html?...` |

### ✅ Vantagens

- **Automático:** Não precisa configurar nada
- **Inteligente:** Adapta-se ao contexto de acesso
- **Flexível:** Funciona em DEV, PROD, e Cloudflare
- **Sem código duplicado:** Uma única lógica para todos os casos

---

## 🌐 URLs por Ambiente

### Desenvolvimento (DEV)

**Backend:** `http://localhost:8001`

**Acesso Interno:**
- Interface: `http://localhost:8001/analise.html`
- Link gerado: `http://localhost:8001/client_pt.html?token=...`

### Produção (PROD) - Rede Local

**Backend:** `http://10.120.1.12:8000`

**Acesso Interno:**
- Interface: `http://10.120.1.12:8000/analise.html`
- Link gerado: `http://10.120.1.12:8000/client_pt.html?token=...`

### Produção - Internet (Cloudflare)

**Backend:** `http://10.120.1.12:8000` (mesmo)  
**Túnel:** `https://sagra.camara.leg.br`

**Acesso Externo:**
- ❌ Interface: **NÃO DISPONÍVEL** (analise.html bloqueada)
- ✅ Link gerado: `https://sagra.camara.leg.br/client_pt.html?token=...`

---

## 🔧 Como Usar Links Externos

### Opção 1: Gerar Link Internamente (Recomendado)

1. **Acesse** `http://10.120.1.12:8000/analise.html` (rede local)
2. **Conclua** a análise normalmente
3. **Copie** o link gerado: `http://10.120.1.12:8000/client_pt.html?token=ABC123`
4. **Substitua manualmente** o domínio:
   - **De:** `http://10.120.1.12:8000`
   - **Para:** `https://sagra.camara.leg.br`
5. **Link final:** `https://sagra.camara.leg.br/client_pt.html?token=ABC123`
6. **Envie** para o cliente

### Opção 2: Configurar Domínio Padrão (Futuro)

Para gerar automaticamente links externos, adicione variável de ambiente:

```python
# Em analise_routes.py
import os

# Usar domínio público se configurado
PUBLIC_DOMAIN = os.getenv("SAGRA_PUBLIC_DOMAIN", None)

if PUBLIC_DOMAIN:
    final_url = f"{PUBLIC_DOMAIN}/client_pt.html?os={os_id}&ano={ano}&token={token}"
else:
    # Lógica atual (referer)
    ...
```

Depois configure:
```powershell
# Windows - Persistente
[System.Environment]::SetEnvironmentVariable("SAGRA_PUBLIC_DOMAIN", "https://sagra.camara.leg.br", "Machine")
```

**Reinicie o backend** após configurar.

---

## 📧 Integração com E-mail

### Email PT (email_pt2.html)

O template de e-mail já usa o link gerado:

```html
<a href="LINK_SERA_SUBSTITUIDO" style="...">
    ACESSAR PORTAL DO CLIENTE
</a>
```

**Substituição automática** em [analise_routes.py](routers/analise_routes.py):
```python
# Encontra e substitui o link no template
pattern = r'href="[^"]*client_pt\.html[^"]*"'
replacement = f'href="{final_url}"'
email_html = re.sub(pattern, replacement, email_html)
```

### Comportamento

| Geração de onde | Link no e-mail |
|-----------------|----------------|
| Rede local | `http://10.120.1.12:8000/client_pt.html?...` |
| (após Cloudflare) | `https://sagra.camara.leg.br/client_pt.html?...` |

### ⚠️ Para E-mails Externos

Se enviar e-mail para cliente externo (sem VPN):
- ✅ **Usar:** `https://sagra.camara.leg.br/client_pt.html?...`
- ❌ **NÃO usar:** `http://10.120.1.12:8000/...` (não funciona fora da rede)

**Solução temporária:** Editar manualmente link no e-mail antes de enviar

**Solução definitiva:** Configurar `SAGRA_PUBLIC_DOMAIN` (ver Opção 2 acima)

---

## 🔒 Segurança dos Links

### Tokens

- **Formato:** 64 caracteres aleatórios (`secrets.token_urlsafe(48)`)
- **Validade:** Permanente (enquanto não deletado)
- **Armazenamento:** `tabClientTokens`
- **Validação:** Ao acessar client_pt.html, verifica token no banco

### Limitações

- ✅ Token válido apenas para OS específica
- ✅ Token não expõe informações sensíveis
- ⚠️ Token não expira (considerar implementar expiração futura)
- ⚠️ Token pode ser usado múltiplas vezes

### URLs Exemplo

```
# Link válido
https://sagra.camara.leg.br/client_pt.html?os=1234&ano=2025&token=xK9mN2pQ7wR5sT8vY1zA3bC6dE0fG4hI9jK2lM5nO8pQ1rS4tU7vW0xY3zA6bC9

# Parâmetros necessários:
- os: Número da OS
- ano: Ano da OS  
- token: Token único gerado
```

---

## 🧪 Testar URLs

### Teste 1: Link Local

```powershell
# Gerar link via sistema (rede local)
curl "http://10.120.1.12:8000/api/analise/2025/1234/generate-link" -Method POST -Headers @{"Content-Type"="application/json"} -Body '{"id_analise": 1}'

# Resposta esperada:
{
  "success": true,
  "link": "http://10.120.1.12:8000/client_pt.html?os=1234&ano=2025&token=..."
}

# Acessar link gerado
curl "http://10.120.1.12:8000/client_pt.html?os=1234&ano=2025&token=..." -UseBasicParsing
# Deve retornar HTML da página
```

### Teste 2: Link Externo (via Cloudflare)

```powershell
# Usar mesmo token, mas trocar domínio
curl "https://sagra.camara.leg.br/client_pt.html?os=1234&ano=2025&token=..." -UseBasicParsing

# Deve retornar HTML da página (200 OK)
```

### Teste 3: Token Inválido

```powershell
# Token inválido
curl "https://sagra.camara.leg.br/client_pt.html?os=1234&ano=2025&token=INVALIDO" -UseBasicParsing

# Deve retornar erro de autenticação
```

---

## 📝 Checklist de URLs

### Antes do Deploy

- [ ] Backend rodando em porta 8000 (PROD)
- [ ] DNS Cloudflare configurado
- [ ] Túnel instalado e rodando
- [ ] Middleware de segurança ativo

### Gerar Link de Teste

- [ ] Acesse `http://10.120.1.12:8000/analise.html`
- [ ] Conclua uma análise de teste
- [ ] Copie link gerado
- [ ] Substitua domínio para `https://sagra.camara.leg.br`
- [ ] Teste em navegador externo (sem VPN)
- [ ] Link deve funcionar ✅

### Validar Segurança

- [ ] Link externo funciona para client_pt.html ✅
- [ ] Link externo bloqueado para analise.html ❌
- [ ] Link externo bloqueado para index.html ❌
- [ ] Link local funciona para tudo ✅

---

## 🔄 Migração Gradual

### Fase 1: Manter Ambos (Atual)

**Links locais** para usuários internos:
```
http://10.120.1.12:8000/client_pt.html?...
```

**Links externos** para clientes (manual):
```
https://sagra.camara.leg.br/client_pt.html?...
```

### Fase 2: Transição (Futuro)

Configurar `SAGRA_PUBLIC_DOMAIN`:
- Links gerados automaticamente com domínio público
- Sistema escolhe automaticamente URL correta
- Sem necessidade de edição manual

### Fase 3: Consolidação (Futuro)

Todos os links usam domínio público:
- Interno e externo usam `https://sagra.camara.leg.br`
- Cloudflare permite tudo quando requisição vem da rede interna
- Simplifica geração de links

---

## 🆘 Troubleshooting

### Link não funciona externamente

**Sintoma:** `https://sagra.camara.leg.br/client_pt.html?...` retorna erro

**Verificar:**
1. DNS configurado? `nslookup sagra.camara.leg.br`
2. Túnel rodando? `Get-Service cloudflared`
3. Backend rodando? `curl http://localhost:8000/health`
4. Token válido? Verificar no banco: `SELECT * FROM tabClientTokens WHERE Token = '...'`

### Link funciona local mas não externo

**Causa:** Middleware bloqueando rota

**Verificar:**
```python
# Em api.py
ALLOWED_PUBLIC_ROUTES = [
    "/client_pt.html",  # ← Deve estar presente
    ...
]
```

### Link externo expõe páginas internas

**PROBLEMA CRÍTICO!**

**Verificar:**
1. Middleware instalado? `Get-Service cloudflared` rodando?
2. Config.yml correto? Ver [config.yml](C:\Users\P_918713\.cloudflared\config.yml)
3. Backend reiniciado após adicionar middleware?

**Testar segurança:**
```powershell
.\cloudflare_test.ps1 -Domain "sagra.camara.leg.br"
```

---

## ✅ Resumo

- ✅ **Sistema atual:** Links baseados em referer (automático)
- ✅ **Cloudflare:** Funciona com lógica existente
- ✅ **URLs externas:** Substituir manualmente domínio (temporário)
- ✅ **URLs internas:** Continuam funcionando sem mudanças
- 🔄 **Futuro:** Configurar `SAGRA_PUBLIC_DOMAIN` para automação total

**Links funcionando:**
- Local: `http://10.120.1.12:8000/client_pt.html?token=...`
- Externo: `https://sagra.camara.leg.br/client_pt.html?token=...`

**Segurança validada com [cloudflare_test.ps1](cloudflare_test.ps1)** ✅
