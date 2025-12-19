# 🚀 QUICK REFERENCE - Emails com Template .OFT

## RESUMO EM 1 PÁGINA

### 🎯 O QUE FUNCIONA

```
✅ Finalizar análise → Gera HTML dos problemas → Salva no BD
✅ Enviar email → Carrega .oft template → Substitui placeholder → Envia via Outlook
```

---

### 📝 3 PASSOS DE INTEGRAÇÃO

#### 1️⃣ INCLUIR JAVASCRIPT
```html
<script src="email_oft_integration.js"></script>
```

#### 2️⃣ EVENTO DO BOTÃO CONCLUIR (analise.html)
```javascript
document.getElementById('btn-concluir').addEventListener('click', async (e) => {
    e.preventDefault();
    await PT_Email_OFT.finalizarAnalise();
});
```

#### 3️⃣ EVENTO DO BOTÃO ENVIAR (email.html)
```javascript
document.getElementById('btn-enviar').addEventListener('click', async (e) => {
    e.preventDefault();
    const os = document.getElementById('os').value;
    const ano = document.getElementById('ano').value;
    const versao = "1";
    const para = document.getElementById('para').value.split(';');
    await PT_Email_OFT.enviarEmail(os, ano, versao, para, 'SEFOC');
});
```

**PRONTO! 🎉**

---

### 📁 ARQUIVOS IMPORTANTES

| Arquivo | Localização | Descrição |
|---------|------------|-----------|
| `emailProbTec.oft` | Raiz | Template Outlook (contém placeholder) |
| `email_oft_integration.js` | Raiz | Módulo JavaScript para chamadas |
| `EXEMPLO_ANALISE.html` | Raiz | Exemplo completo para copiar/colar |
| `EXEMPLO_EMAIL.html` | Raiz | Exemplo completo para copiar/colar |

---

### 🔧 FUNÇÕES JAVASCRIPT

```javascript
// Finalizar análise (call ao clicar "Concluir")
await PT_Email_OFT.finalizarAnalise()

// Enviar email PT (call ao clicar "Enviar")
await PT_Email_OFT.enviarEmail(os, ano, versao, [emails], 'SEFOC')

// Ver logs
PT_Email_OFT.showLogsReport()

// Limpar logs
PT_Email_OFT.clearLogs()
```

---

### 🔌 ROTAS BACKEND

```bash
# Finalizar análise
POST /analise/finalize/{ano}/{os_id}

# Enviar email (type="pt" usa .OFT)
POST /send-pt
{
    "os": 1234,
    "ano": 2024,
    "versao": "1",
    "to": ["email@test.com"],
    "ponto": "SEFOC",
    "type": "pt"
}
```

---

### 📋 CHECKLIST FINAL

- [ ] `email_oft_integration.js` carregando (F12 → Console)
- [ ] Variáveis `OS_ID` e `ANO` definidas globalmente
- [ ] Botão "Concluir" com evento click adicionado
- [ ] Botão "Enviar" com evento click adicionado
- [ ] Campos de formulário: `os`, `ano`, `versao`, `para`, `ponto`
- [ ] `emailProbTec.oft` existe na raiz
- [ ] Outlook instalado na máquina
- [ ] Colunas de BD criadas

---

### 🧪 TESTE RÁPIDO

```bash
# 1. Testar função de geração de HTML
python -c "from routers.email_routes import _generate_problemas_html; 
html = _generate_problemas_html([{'titulo': 'Test', 'obs': 'OK'}]); 
print('✓ HTML gerado' if '<div' in html else '✗ Erro')"

# 2. Testar rota backend
curl -X POST http://localhost:8000/analise/finalize/2024/1234 \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. Testar via interface web
# Abrir analise.html → Marcar problemas → Clicar "Concluir"
# Abrir email.html → Preencher email → Clicar "Enviar"
```

---

### 🎯 FLUXO EM 5 PASSOS

```
1. Usuário marca problemas em analise.html
    ↓
2. Clica "Concluir"
    ↓
3. finalizarAnalise() → POST /analise/finalize
    ↓
4. Backend: SELECT problemas → HTML gerado → SAVE em BD
    ↓
5. Alert: "✓ Análise finalizada!"
    
---

6. Usuário vai para email.html
    ↓
7. Preenche: para = "email@test.com"
    ↓
8. Clica "Enviar"
    ↓
9. enviarEmail() → POST /send-pt (type="pt")
    ↓
10. Backend: GET HTML do BD → Load .oft → Replace placeholder → Send via Outlook
    ↓
11. Alert: "✓ Email enviado!"
    ↓
12. Outlook recebe email com HTML dinâmico inserido ✅
```

---

### ⚠️ 5 ERROS COMUNS

| Erro | Causa | Fix |
|------|-------|-----|
| "PT_Email_OFT is not defined" | Script não carregado | `<script src="email_oft_integration.js">` |
| "OS_ID não definido" | Variável global faltando | `window.OS_ID = 1234;` |
| "Template não encontrado" | Arquivo ausente | Colocar `emailProbTec.oft` na raiz |
| "Placeholder não substituído" | Texto errado | Usar exato: `<<<CONTEUDO_PROBLEMAS>>>` |
| "Outlook não abre" | COM não funciona | Reinstalar Outlook ou `pywin32` |

---

### 📊 VARIÁVEIS GLOBAIS NECESSÁRIAS

```javascript
window.OS_ID = 1234;      // Número da OS
window.ANO = 2024;        // Ano da OS
// OU obter de parâmetros URL/BD
```

---

### 🎁 BÔNUS: LOGGING EM PRODUÇÃO

```javascript
// Ver último status
localStorage.getItem('email_logs')

// Limpar tudo
localStorage.removeItem('email_logs')

// Ver em console
console.log(JSON.parse(localStorage.getItem('email_logs')))
```

---

### 📞 AJUDA RÁPIDA

**Problema**: Placeholder não é substituído no email  
**Solução**: 
1. Verificar se placeholder em .OFT é `<<<CONTEUDO_PROBLEMAS>>>`
2. Checar se não tem espaços extras
3. Recriar arquivo .OFT se corrompido

**Problema**: "Erro ao enviar email com template .oft"  
**Solução**:
1. Outlook instalado? `python -c "import win32com.client; print('OK')"`
2. Arquivo existe? `ls emailProbTec.oft`
3. HTML gerado? `SELECT LENGTH(email_pt_html) FROM tabProtocolos WHERE ...`

**Problema**: Email enviado mas sem HTML  
**Solução**:
1. Checar se `email_pt_html` foi salvo no BD
2. Rodar `/analise/finalize` antes de enviar
3. Verificar logs: `grep -i "problema" logs/email_*.log`

---

### 💻 COMANDOS ÚTEIS

```bash
# Testar backend rapidamente
python test_email_oft_flow.py

# Ver logs de erro
tail -f logs/email_*.log | grep ERROR

# Verificar banco de dados
mysql -u root -p SAGRA -e "SELECT NroProtocolo, email_pt_versao, LENGTH(email_pt_html) FROM tabProtocolos WHERE email_pt_html IS NOT NULL LIMIT 5;"

# Verificar Outlook
python -c "import win32com.client; outlook = win32com.client.Dispatch('Outlook.Application'); print('Outlook OK')"
```

---

### 🚀 DEPLOY CHECKLIST

- [ ] Backend pronto (testes passam)
- [ ] Frontend integrado (botões funcionam)
- [ ] Outlook funcionando
- [ ] BD atualizado com colunas
- [ ] `emailProbTec.oft` na raiz
- [ ] `email_oft_integration.js` na raiz
- [ ] Logs habilitados
- [ ] Testes manuais ok

**DEPLOY LIBERADO ✅**

---

**Última atualização**: 2024  
**Versão**: 1.0  
**Status**: Production Ready
