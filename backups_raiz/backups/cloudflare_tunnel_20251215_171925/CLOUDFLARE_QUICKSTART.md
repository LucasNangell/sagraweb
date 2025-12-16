# 🚀 QUICK START - Cloudflare Tunnel

## ⚡ Instalação Rápida (5 minutos)

### 1️⃣ Configurar DNS no Cloudflare

**Acesse:** https://dash.cloudflare.com

1. Selecione domínio: `camara.leg.br`
2. Vá em **DNS** → **Add record**
3. Configure:
   - **Type:** CNAME
   - **Name:** sagra
   - **Target:** `27a38465-be6a-4047-9b16-e901676de216.cfargotunnel.com`
   - **Proxy:** ✅ Ativado (nuvem laranja)
4. **Save**

### 2️⃣ Instalar Túnel como Serviço

**Execute como Administrador:**

```powershell
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb
.\cloudflare_install_service.ps1
```

Aguarde mensagem: ✅ **INSTALAÇÃO CONCLUÍDA!**

### 3️⃣ Reiniciar Backend

**Terminal 1:**
```powershell
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb
& .venv\Scripts\Activate.ps1
python main.py
```

Backend deve iniciar em: `http://0.0.0.0:8001`

### 4️⃣ Testar

```powershell
# Novo terminal
cd C:\Users\P_918713\Desktop\Antigravity\SagraWeb
.\cloudflare_test.ps1 -Domain "sagra.camara.leg.br"
```

---

## ✅ Verificação Rápida

### Teste Manual (Navegador)

**DEVEM FUNCIONAR:**
- ✅ https://sagra.camara.leg.br/client_pt.html
- ✅ https://sagra.camara.leg.br/client_proof.html

**DEVEM SER BLOQUEADAS:**
- ❌ https://sagra.camara.leg.br/ (403/404)
- ❌ https://sagra.camara.leg.br/index.html (403/404)
- ❌ https://sagra.camara.leg.br/gerencia.html (403/404)

**ACESSO LOCAL (continua funcionando):**
- ✅ http://10.120.1.12:8000/index.html
- ✅ http://10.120.1.12:8000/gerencia.html

---

## 🔧 Comandos Úteis

```powershell
# Status do túnel
Get-Service cloudflared

# Ver logs
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 50

# Reiniciar túnel
Restart-Service cloudflared

# Parar túnel (reversão temporária)
Stop-Service cloudflared
```

---

## 🆘 Problemas Comuns

### Túnel não inicia
```powershell
# Ver erro específico
Get-Content C:\Users\P_918713\.cloudflared\tunnel.log -Tail 100
```

### DNS não resolve
- Aguarde 1-2 minutos após criar DNS
- Verifique proxy ativado (nuvem laranja)

### Página pública bloqueada
- Reinicie backend: `python main.py`
- Verifique backend rodando: `curl http://localhost:8000/health`

---

## 📚 Documentação Completa

Para detalhes: [CLOUDFLARE_TUNNEL_SETUP.md](CLOUDFLARE_TUNNEL_SETUP.md)

---

## ✨ Pronto!

Seus clientes agora podem acessar via:
**https://sagra.camara.leg.br/client_pt.html?token=...**

Sistema interno permanece protegido! 🔒
