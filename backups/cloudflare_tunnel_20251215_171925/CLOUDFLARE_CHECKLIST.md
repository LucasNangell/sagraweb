# ✅ CHECKLIST - Deploy Cloudflare Tunnel

**Túnel:** sagra  
**ID:** 27a38465-be6a-4047-9b16-e901676de216  
**Data:** _____________  
**Responsável:** _____________  

---

## 📋 PRÉ-REQUISITOS

- [ ] Cloudflared instalado
- [ ] Túnel criado (sagra)
- [ ] Arquivo credentials existe
- [ ] Acesso ao Cloudflare Dashboard
- [ ] Permissões de Administrador Windows

---

## 🔧 INSTALAÇÃO

### 1️⃣ Configuração DNS (Cloudflare Dashboard)

- [ ] Acessar https://dash.cloudflare.com
- [ ] Selecionar domínio: `camara.leg.br`
- [ ] Ir em **DNS** → **Add record**
- [ ] Configurar CNAME:
  - **Type:** CNAME
  - **Name:** sagra
  - **Target:** `27a38465-be6a-4047-9b16-e901676de216.cfargotunnel.com`
  - **Proxy:** ✅ Ativado (nuvem laranja)
- [ ] Clicar em **Save**
- [ ] Verificar: `nslookup sagra.camara.leg.br`

**Tempo estimado:** 2 minutos

---

### 2️⃣ Instalação do Serviço Windows

- [ ] Abrir PowerShell **como Administrador**
- [ ] Navegar: `cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb`
- [ ] Executar: `.\cloudflare_install_service.ps1`
- [ ] Aguardar mensagem: "✅ INSTALAÇÃO CONCLUÍDA!"
- [ ] Verificar status: `Get-Service cloudflared`
- [ ] Confirmar: **Status: Running**

**Tempo estimado:** 3 minutos

---

### 3️⃣ Reiniciar Backend

- [ ] Parar Python: `Get-Process python | Stop-Process -Force`
- [ ] Ativar venv: `& .venv\Scripts\Activate.ps1`
- [ ] Iniciar: `python main.py`
- [ ] Aguardar: "Application startup complete"
- [ ] Verificar: `curl http://localhost:8000/health`

**Tempo estimado:** 2 minutos

---

## 🧪 TESTES

### 4️⃣ Testes Automatizados

- [ ] Executar: `.\cloudflare_test.ps1 -Domain "sagra.camara.leg.br"`
- [ ] Aguardar conclusão
- [ ] Verificar: "🎉 TODOS OS TESTES PASSARAM!"
- [ ] Revisar logs se houver falhas

**Tempo estimado:** 2 minutos

---

### 5️⃣ Testes Manuais - Acesso Externo

**Páginas PÚBLICAS (devem funcionar):**

- [ ] `https://sagra.camara.leg.br/client_pt.html`
  - Status: _____ (esperado: 200 OK ou 404 sem token)
  
- [ ] `https://sagra.camara.leg.br/client_proof.html`
  - Status: _____ (esperado: 200 OK ou 404 sem token)

**Páginas INTERNAS (devem bloquear):**

- [ ] `https://sagra.camara.leg.br/` 
  - Status: _____ (esperado: 403 ou 404)
  
- [ ] `https://sagra.camara.leg.br/index.html`
  - Status: _____ (esperado: 403 ou 404)
  
- [ ] `https://sagra.camara.leg.br/gerencia.html`
  - Status: _____ (esperado: 403 ou 404)
  
- [ ] `https://sagra.camara.leg.br/analise.html`
  - Status: _____ (esperado: 403 ou 404)
  
- [ ] `https://sagra.camara.leg.br/dashboard_setor.html`
  - Status: _____ (esperado: 403 ou 404)

**Tempo estimado:** 5 minutos

---

### 6️⃣ Testes Manuais - Acesso Local

**Todas as páginas devem funcionar:**

- [ ] `http://10.120.1.12:8000/index.html`
  - Status: _____ (esperado: 200 OK)
  
- [ ] `http://10.120.1.12:8000/gerencia.html`
  - Status: _____ (esperado: 200 OK)
  
- [ ] `http://10.120.1.12:8000/analise.html`
  - Status: _____ (esperado: 200 OK)
  
- [ ] `http://10.120.1.12:8000/client_pt.html`
  - Status: _____ (esperado: 200 OK ou 404 sem token)

**Tempo estimado:** 3 minutos

---

### 7️⃣ Teste de Link Cliente (Fim a Fim)

- [ ] Acessar: `http://10.120.1.12:8000/analise.html`
- [ ] Selecionar uma OS de teste
- [ ] Concluir análise
- [ ] Copiar link gerado
- [ ] Link gerado: ________________________________
- [ ] Substituir domínio:
  - **De:** `http://10.120.1.12:8000`
  - **Para:** `https://sagra.camara.leg.br`
- [ ] Link externo: ________________________________
- [ ] Testar link em navegador (sem VPN)
- [ ] Página carrega corretamente: ☐ Sim ☐ Não
- [ ] Observações: ________________________________

**Tempo estimado:** 5 minutos

---

## 🔒 VALIDAÇÃO DE SEGURANÇA

### 8️⃣ Verificações de Segurança

**Logs do Túnel:**

- [ ] Abrir logs: `Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 50`
- [ ] Verificar conexão estabelecida
- [ ] Sem erros críticos
- [ ] Observações: ________________________________

**Logs do Backend:**

- [ ] Verificar middleware ativo
- [ ] Procurar: "Cloudflare: Acesso permitido/bloqueado"
- [ ] Confirmar detecção de headers CF-*
- [ ] Observações: ________________________________

**Headers Cloudflare:**

- [ ] Testar: `curl https://sagra.camara.leg.br/health -v 2>&1 | Select-String "CF-"`
- [ ] Deve conter: `CF-Ray` ou `CF-Connecting-IP`
- [ ] Observações: ________________________________

**Tempo estimado:** 5 minutos

---

## 📊 VALIDAÇÃO DE PRODUÇÃO

### 9️⃣ Teste de Estabilidade

**Após 1 hora:**

- [ ] Serviço cloudflared: `Get-Service cloudflared`
  - Status: _____ (esperado: Running)
  
- [ ] Backend Python rodando
  
- [ ] Túnel sem erros nos logs
  
- [ ] Acesso externo funcionando

**Após 24 horas:**

- [ ] Serviço cloudflared: `Get-Service cloudflared`
  - Status: _____ (esperado: Running)
  
- [ ] Túnel sobreviveu a reinicializações
  
- [ ] Sem degradação de performance
  
- [ ] Logs sem erros críticos

**Observações:** ________________________________

---

### 🔟 Teste com Cliente Real

- [ ] Gerar link para cliente real
- [ ] Enviar link por e-mail
- [ ] Cliente consegue acessar (sem VPN): ☐ Sim ☐ Não
- [ ] Página carrega rapidamente: ☐ Sim ☐ Não
- [ ] Funcionalidades da página OK: ☐ Sim ☐ Não
- [ ] Feedback do cliente: ________________________________

**Tempo estimado:** 10 minutos (+ tempo de resposta do cliente)

---

## 🔄 ROLLBACK (se necessário)

### Reversão Temporária

- [ ] Parar túnel: `Stop-Service cloudflared`
- [ ] Sistema volta para acesso apenas local
- [ ] Notificar clientes sobre indisponibilidade

### Reversão Permanente

- [ ] Parar serviço: `Stop-Service cloudflared`
- [ ] Desinstalar: `cloudflared service uninstall`
- [ ] Remover DNS no Cloudflare Dashboard
- [ ] Comentar middleware em `api.py`
- [ ] Reiniciar backend

**Motivos para rollback:** ________________________________

---

## 📝 PÓS-DEPLOY

### Documentação

- [ ] Atualizar documentação interna
- [ ] Registrar URLs finais:
  - Externa: `https://sagra.camara.leg.br`
  - Interna: `http://10.120.1.12:8000`
- [ ] Documentar procedimentos de troubleshooting
- [ ] Criar runbook para equipe

### Comunicação

- [ ] Notificar equipe sobre novo domínio
- [ ] Atualizar templates de e-mail (se necessário)
- [ ] Informar clientes sobre nova URL
- [ ] Atualizar wikis/documentação externa

### Monitoramento

- [ ] Configurar alertas de downtime (opcional)
- [ ] Monitorar logs por 1 semana
- [ ] Acompanhar métricas de acesso
- [ ] Revisar performance

---

## ✅ APROVAÇÃO FINAL

**Deploy concluído com sucesso:**

- [ ] Todos os testes passaram
- [ ] Segurança validada
- [ ] Cliente consegue acessar
- [ ] Sistema interno funcionando
- [ ] Documentação atualizada

**Assinaturas:**

Responsável técnico: _____________________________ Data: _____

Aprovador: _____________________________ Data: _____

---

## 📞 SUPORTE

**Comandos úteis:**

```powershell
# Status do túnel
Get-Service cloudflared

# Logs em tempo real
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Wait -Tail 20

# Reiniciar túnel
Restart-Service cloudflared

# Testar configuração
cloudflared tunnel ingress validate

# Ver rotas
cloudflared tunnel ingress rule https://sagra.camara.leg.br/client_pt.html
```

**Documentação:**
- Completa: `CLOUDFLARE_TUNNEL_SETUP.md`
- Quick Start: `CLOUDFLARE_QUICKSTART.md`
- URLs: `CLOUDFLARE_URLS.md`

**Contatos:**
- Cloudflare Support: https://support.cloudflare.com
- Documentação Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/

---

**TOTAL TEMPO ESTIMADO:** ~40 minutos  
**STATUS FINAL:** ☐ ✅ Sucesso  ☐ ⚠️ Com ressalvas  ☐ ❌ Falhou

**Observações finais:**

_______________________________________________________________

_______________________________________________________________

_______________________________________________________________
