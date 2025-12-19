# Implementação do Fluxo de Emails de Problemas Técnicos com Template .OFT

## 📋 Status da Implementação

### ✅ Concluído (Backend)
- [x] Função `_generate_problemas_html()` - Gera HTML formatado dos problemas
- [x] Função `_send_email_with_oft_template()` - Envia email usando template .OFT
- [x] Rota `POST /analise/finalize/{ano}/{os_id}` - Finaliza análise e gera HTML
- [x] Rota `POST /send-pt` - Modificada para usar template .OFT quando tipo="pt"
- [x] Arquivo `emailProbTec.oft` - Contém placeholder `<<<CONTEUDO_PROBLEMAS>>>`
- [x] Armazenamento em banco - `tabProtocolos.email_pt_html`, `email_pt_versao`, `email_pt_data`

### 🔄 Pendente (Frontend)
- [ ] Integrar `analise.html` para chamar `/analise/finalize` ao clicar "Concluir"
- [ ] Integrar `email.html` para chamar `/send-pt` com `type="pt"` para problemas técnicos
- [ ] Adicionar controles UI para versão e tipo de email
- [ ] Testar fluxo completo end-to-end

---

## 🚀 Instruções de Implementação

### Passo 1: Incluir arquivo JavaScript de integração

Em `analise.html` e `email.html`, adicionar no `<head>`:

```html
<script src="email_oft_integration.js"></script>
```

### Passo 2: Integrar com analise.html

#### Localizar o botão "Concluir"
```html
<button id="btn-concluir">Concluir Análise</button>
```

#### Substituir ou adicionar evento de clique:
```javascript
// No final de analise.html, dentro de <script>
document.getElementById('btn-concluir').addEventListener('click', async (e) => {
    e.preventDefault();
    
    // Os_ID e ANO devem estar definidos globalmente
    const sucesso = await PT_Email_OFT.finalizarAnalise();
    
    if (sucesso) {
        // Opcional: Redirecionar para email.html
        // setTimeout(() => {
        //     window.location.href = 'email.html';
        // }, 1500);
    }
});
```

**OU** chamar diretamente:
```javascript
// Se usar a abordagem simples, basta chamar:
async function concluirAnalise() {
    await PT_Email_OFT.finalizarAnalise();
}
```

### Passo 3: Integrar com email.html

#### Localizar o botão "Enviar"
```html
<button id="btn-enviar">Enviar Email</button>
```

#### Substituir ou adicionar evento de clique:
```javascript
// No final de email.html, dentro de <script>
document.getElementById('btn-enviar').addEventListener('click', async (e) => {
    e.preventDefault();
    
    // Coletar dados do formulário
    const os_id = document.getElementById('os').value;
    const ano = document.getElementById('ano').value;
    const versao = document.getElementById('versao').value || "1";
    const para = document.getElementById('para').value;
    const tipo_email = document.querySelector('input[name="tipo_email"]:checked').value;
    
    // Validar se é email de Problemas Técnicos
    if (tipo_email !== 'pt') {
        console.log('Usando rota padrão para tipo:', tipo_email);
        // Chamar função existente para outros tipos
        // await enviarEmailOriginal(...);
        return;
    }
    
    // Converter destinatários para array
    const destinatarios = para
        .split(';')
        .map(e => e.trim())
        .filter(e => e.length > 0);
    
    if (destinatarios.length === 0) {
        alert('Favor informar pelo menos um destinatário');
        return;
    }
    
    // Enviar com template .OFT
    const sucesso = await PT_Email_OFT.enviarEmail(
        os_id, 
        ano, 
        versao, 
        destinatarios,
        'SEFOC'
    );
    
    if (sucesso) {
        // Limpar formulário
        document.getElementById('para').value = '';
        // Opcional: mostrar mensagem de sucesso
    }
});
```

### Passo 4: Adicionar campos de formulário (se necessário)

Se `email.html` não tiver os campos abaixo, adicionar:

```html
<!-- Campo OS (se não existir) -->
<input type="hidden" id="os" value="1234">

<!-- Campo Ano (se não existir) -->
<input type="hidden" id="ano" value="2024">

<!-- Campo Versão -->
<label>Versão do Email:</label>
<input type="text" id="versao" value="1" placeholder="1, 2, 3...">

<!-- Tipo de Email -->
<label>
    <input type="radio" name="tipo_email" value="pt" checked> Problemas Técnicos
</label>
<label>
    <input type="radio" name="tipo_email" value="proof"> Prova
</label>

<!-- Para (destinatários) -->
<label>Destinatários:</label>
<input type="text" id="para" placeholder="email1@dominio.com; email2@dominio.com">

<!-- Botão Enviar -->
<button id="btn-enviar">Enviar Email</button>
```

---

## 🧪 Testes

### Teste 1: Validação Rápida
Execute o script de testes:
```bash
python test_email_oft_flow.py
```

### Teste 2: Teste Manual Completo

#### Via interface web:
1. Abrir `analise.html`
2. Marcar alguns "Problemas Técnicos" (checkboxes)
3. Clicar em "Concluir"
4. Verificar se aparece mensagem "Análise finalizada!"
5. Abrir `email.html`
6. Selecionar tipo "Problemas Técnicos"
7. Informar destinatários
8. Clicar em "Enviar"
9. Verificar se Outlook recebe o email com HTML inserido

#### Via curl (terminal):
```bash
# 1. Finalizar análise
curl -X POST http://localhost:8000/analise/finalize/2024/1234 \
  -H "Content-Type: application/json" \
  -d '{}'

# Resposta esperada:
# {
#   "status": "success",
#   "message": "Análise finalizada e HTML dos problemas técnicos gerado",
#   "html_preview": "<div style=\"font-family: Calibri...>"
# }

# 2. Enviar email PT
curl -X POST http://localhost:8000/send-pt \
  -H "Content-Type: application/json" \
  -d '{
    "os": 1234,
    "ano": 2024,
    "versao": "1",
    "to": ["teste@camara.leg.br"],
    "ponto": "SEFOC",
    "type": "pt"
  }'

# Resposta esperada:
# {
#   "success": true,
#   "message": "E-mail enviado com sucesso",
#   "subject": "CGraf: Problemas Técnicos, arq. v1 OS 1234/24 - Produto - Título",
#   "used_account": "papelaria.deapa@camara.leg.br (via .oft template)"
# }
```

### Teste 3: Verificação de Banco de Dados

```sql
-- Verificar se HTML foi salvo
SELECT 
    NroProtocolo,
    AnoProtocolo,
    email_pt_versao,
    email_pt_data,
    LENGTH(email_pt_html) as html_size
FROM tabProtocolos
WHERE NroProtocolo = 1234 AND AnoProtocolo = 2024;
```

---

## 📁 Arquivos Modificados/Criados

| Arquivo | Tipo | Status | Descrição |
|---------|------|--------|-----------|
| `routers/email_routes.py` | Modificado | ✅ | Adicionadas funções `_generate_problemas_html()` e `_send_email_with_oft_template()`. Rota `send_pt_email()` modificada para usar .OFT |
| `routers/analise_routes.py` | Modificado | ✅ | Adicionada rota `finalize_analysis()` para gerar HTML |
| `emailProbTec.oft` | Existente | ✅ | Contém placeholder `<<<CONTEUDO_PROBLEMAS>>>` |
| `email_oft_integration.js` | Criado | ✅ | Módulo JavaScript para integração frontend |
| `test_email_oft_flow.py` | Criado | ✅ | Suite de testes para validar fluxo |
| `FLUXO_EMAIL_OFT.md` | Criado | ✅ | Documentação técnica completa |
| `analise.html` | Pendente | 🔄 | Integrar chamada a `PT_Email_OFT.finalizarAnalise()` |
| `email.html` | Pendente | 🔄 | Integrar chamada a `PT_Email_OFT.enviarEmail()` |

---

## 🔍 Debugging

### Verificar se template .OFT é carregado
```python
import os
oft_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "emailProbTec.oft")
print(f"Caminho: {oft_path}")
print(f"Existe: {os.path.exists(oft_path)}")
```

### Verificar logs
```bash
# Ver últimos logs de email
tail -f logs/email_*.log

# Procurar por erros específicos
grep -i "oft\|placeholder\|conteudo" logs/email_*.log
```

### Testar placeholder em Python
```python
from routers.email_routes import _generate_problemas_html

problemas = [
    {"titulo": "Test 1", "obs": "Observação 1"}
]

html = _generate_problemas_html(problemas)
print("HTML gerado:")
print(html)

# Testar substituição
template = "Antes <<<CONTEUDO_PROBLEMAS>>> Depois"
resultado = template.replace("<<<CONTEUDO_PROBLEMAS>>>", html)
print("\nSubstituição:")
print(resultado[:200] + "...")
```

---

## ⚠️ Possíveis Problemas e Soluções

| Problema | Causa | Solução |
|----------|-------|---------|
| "Template .oft não encontrado" | Arquivo não está no diretório raiz | Verificar localização de `emailProbTec.oft` |
| "HTML do e-mail não encontrado" | Análise não foi finalizada | Clicar em "Concluir" na tela de análise primeiro |
| Email sem placeholder substituído | .OFT não tem placeholder exato | Verificar se placeholder é exatamente `<<<CONTEUDO_PROBLEMAS>>>` |
| Outlook COM não está disponível | Outlook não instalado | Instalar Outlook ou usar máquina com Outlook |
| Caracteres corrompidos no HTML | Encoding incorreto | Verificar que `email_oft_integration.js` está carregando |
| Versão não está sendo salva | Campo `versao` não preenchido | Verificar se campo é enviado no POST |

---

## 📞 Suporte

Para problemas ou dúvidas:

1. Verificar logs em `logs/email_*.log`
2. Executar `test_email_oft_flow.py` para diagnóstico
3. Consultar `FLUXO_EMAIL_OFT.md` para detalhes técnicos
4. Verificar se todas as modificações foram aplicadas conforme indicado

---

## 📝 Checklist Final

Antes de considerar implementação completa:

- [ ] `analise.html` chama `PT_Email_OFT.finalizarAnalise()` ao clicar "Concluir"
- [ ] `email.html` chama `PT_Email_OFT.enviarEmail()` para tipo "pt"
- [ ] Banco de dados tem colunas `email_pt_html`, `email_pt_versao`, `email_pt_data`
- [ ] Arquivo `emailProbTec.oft` existe no diretório raiz
- [ ] Template .OFT contém placeholder `<<<CONTEUDO_PROBLEMAS>>>`
- [ ] `email_oft_integration.js` está incluído em ambas as páginas
- [ ] Testes manuais passam com sucesso
- [ ] Logs mostram mensagens de sucesso
- [ ] Outlook recebe emails com HTML corretamente inserido
