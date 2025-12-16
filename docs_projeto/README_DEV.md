# Ambiente DEV - SAGRA Sistema

## 🔐 Segurança em DEV

Este ambiente DEV está **PROTEGIDO POR IP WHITELIST**.

### IP Autorizado
- **10.120.1.12** (seu IP - já configurado)

### Características de Segurança
- ✅ Middleware IP ativo - apenas IPs na whitelist podem acessar
- ✅ Tabela `tabIpPermitidos` no banco de dados gerencia IPs
- ✅ Interface admin em `/admin_ips.html` para gerenciar IPs
- ✅ Exceções: Rotas `/client*` acessíveis sem restrição (páginas públicas)

### Gerenciar IPs Autorizados

**Via Interface Admin:**
1. Acesse: http://localhost:8001/admin_ips.html
2. Visualize, adicione, edite ou delete IPs
3. Ative/desative IPs conforme necessário

**Via Script Python:**
```bash
python scripts/add_allowed_ip.py
```

**Via Banco de Dados:**
```sql
-- Ver IPs autorizados
SELECT ip, descricao, ativo FROM tabIpPermitidos;

-- Adicionar novo IP
INSERT INTO tabIpPermitidos (ip, descricao, ativo) 
VALUES ('192.168.1.100', 'Novo IP', 1);

-- Desativar IP
UPDATE tabIpPermitidos SET ativo = 0 WHERE ip = '192.168.1.100';
```

## 🚀 Iniciar DEV

### Via Script Launcher
```bash
# Windows CMD
start_dev.bat

# PowerShell
.\start_dev.ps1
```

### Manual
Prefer using the modular entrypoint so DEV and PROD run the same app entry:
```bash
.venv\Scripts\activate.bat
# Option A - launcher that runs the modular app
python main.py

# Option B - direct uvicorn pointing to the modular router app
python -m uvicorn routers.api:app --host 0.0.0.0 --port 8001 --reload
```

## 📊 Configuração Atual

| Config | Valor |
|--------|-------|
| Porta | 8001 |
| IP Restrito | Sim (tabIpPermitidos) |
| IPs Autorizados | 10.120.1.12 |
| Ambiente | Development |
| Reload | Ativo |

## 🔄 Ambiente PROD

- **Pasta:** `../SAGRA_PROD/`
- **Porta:** 8000
- **IP Middleware:** Desativado (acesso público)
- **Launcher:** `../start_prod.bat` ou `../start_prod.ps1`

---

**Versão:** 6.9 | **Última atualização:** Dezembro 2025
